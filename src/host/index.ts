// src/host/index.ts — dsh-prompt-inject host 主入口。
//
// 职责：
//  1) 提示词管理 HTTP API（/prompts 的 GET/POST、/prompts/{id} 的 PUT/DELETE）。
//  2) /inject：手动一次性注入——把某条提示词排入目标会话队列；下一次该会话模型 step
//     进入前，若提示词**已不在窗口中**则注入一次（只注入一次，绝不改 system prompt）。
//  3) 逐步注入：条件命中（思考之后 / 某工具调用后）→ 入队 → 下一次 pre-step 同样按
//     「是否还在窗口中」判断：不在窗口才注入一次。
//  4) /page：返回自包含管理页面 HTML（原生 JS，新标签页打开）。
//
// 注入机制（关键设计）：
//  - 唯一判断 = 提示词是否还在窗口中（即将发给模型的 messages 里是否仍包含提示词原文）。
//    不再做任何“指令遵循 / 合规”判定，也不再发起任何旁路 LLM 调用。
//  - 注入采用 **agent/pre-step user-role 消息**（对齐 dsh-mnemon searchPrompt）：
//    在 step 的 messages 末尾追加一条 role:'user' 的插件消息。**绝不改 system prompt**。
//
// 铁律：
//  - llm/stream 监听器内**绝不 yield 新建/改写 chunk 对象**——曾触发 agent-loop 落盘
//    assistant/chunk 序列化失败。监听器只读取 chunk 元数据、原样 yield 透传。
//  - 瀑布流正确范式：先 await next() 拿下游决策，修改后返回新对象；直接改入参 + return
//    next() 的修改可能被丢弃。
//  - 监听器必须在 apply() 持久作用域注册（cordis fiber 绑定：HTTP 请求 fiber 里注册会被
//    清理导致不生效。

import { loadPrompts, savePrompts, newId, getStepConfig, setStepConfig, sessionStepConfig, type PromptItem, type StepConfig } from './store.ts'
import { PANEL_PAGE_HTML } from './page.ts'

const PLUGIN_BASE = '/plugins/dsh-prompt-inject'
const INJECT_TTL_MS = 10 * 60 * 1000 // 排队 10 分钟后自动失效

function sendJson(res: any, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readBody(req: any): Promise<any> {
  const chunks: string[] = []
  for await (const chunk of req) chunks.push(String(chunk))
  try {
    return JSON.parse(chunks.join('') || '{}')
  } catch {
    return {}
  }
}

/** 从 req.url 解析 /prompts/{id} 的 id（去掉 /prompts/ 前缀后的首段）。无则返回 ''。 */
function promptIdFromUrl(req: any): string {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname
    const base = `${PLUGIN_BASE}/prompts/`
    if (!pathname.startsWith(base)) return ''
    const id = pathname.slice(base.length).split('/')[0] || ''
    return decodeURIComponent(id)
  } catch {
    return ''
  }
}

export const name = 'dsh-prompt-inject'
export const inject = ['webServer', 'settings']

/** 读取 dsh 外观偏好（theme 命名空间 ui-theme，preference: light|dark|system）。失败返回 system。 */
function readThemePreference(ctx: any): string {
  try {
    const settings = ctx.settings
    if (!settings || typeof settings.scope !== 'function') return 'system'
    const scope = settings.scope('ui-theme')
    if (!scope || typeof scope.get !== 'function') return 'system'
    const value = scope.get()
    const pref = value?.preference
    return pref === 'light' || pref === 'dark' || pref === 'system' ? pref : 'system'
  } catch {
    return 'system'
  }
}

function apply(ctx: any): void {
  // ── 注入队列（持久作用域）──
  // pendingInjections：手动一次性注入（POST /inject 入队）。
  // stepwiseHits：逐步注入（条件命中入队）。
  // 两者在 pre-step 处合并处理，并用 isStillInWindow 判断是否真的需要注入。
  const pendingInjections = new Map<string, { item: PromptItem; timer: any }>()
  const stepwiseHits = new Map<string, { items: PromptItem[]; timer: any; turn: number }>()
  // 轮号/队列：pre-step 每 step 触发并带 payload.turn；条件监听（llm/stream 不含 turn）
  // 用 currentTurn 打戳，保证“本轮内消费、轮末丢弃”。
  const currentTurn = new Map<string, number>()
  // 「窗口」数据源：模型真实收到的请求消息（options.messages，GenerateOptions 契约确认）。
  // 每次 llm/stream 开流时记录该会话窗口内已存在的提示词 id 集合，供 thinking-end 命中
  // 与 pre-step 消费做窗口判断（文档《DSH提示词遵循度监测》§5 messagesContainPrompt 同源）。
  const windowPresent = new Map<string, Set<string>>()

  /** 提示词是否还在窗口中：即将发给模型的 messages 里是否仍包含该提示词原文。 */
  function isStillInWindow(messages: any[] | undefined, text: string): boolean {
    try {
      if (!Array.isArray(messages)) return false
      for (const m of messages) {
        if (!m || !Array.isArray(m.content)) continue
        for (const b of m.content) {
          if (b && (b.type === 'text' || b.type === 'reasoning') && typeof b.text === 'string' && b.text.includes(text)) return true
        }
      }
    } catch {}
    return false
  }

  /** 构造插件 user 消息（对齐 dsh-mnemon createPluginMessage）。 */
  function makeUserMessage(text: string): any {
    return {
      id: `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: name, form: 'instructions' },
    }
  }

  /** 逐步条件命中 → 入队（消费时再看窗口）。仅取【该会话】开启逐步注入且条件含 cond 的提示词。 */
  function queueStepwise(sessionId: string | undefined, cond: string, turn: number | undefined): void {
    if (!sessionId) return
    if (typeof turn !== 'number') {
      try { ctx.logger?.warn?.(`[dsh-prompt-inject] 逐步命中 ${sessionId} @ ${cond} 但 turn 缺失，丢弃`) } catch {}
      return
    }
    const items = loadPrompts().filter((it) => {
      const cfg = getStepConfig(sessionId, it.id)
      return cfg.stepwise === true && Array.isArray(cfg.conditions) && cfg.conditions.includes(cond)
    })
    if (items.length === 0) return
    const existing = stepwiseHits.get(sessionId)
    const merged = existing ? [...existing.items, ...items] : [...items]
    const seen = new Set<string>()
    const dedup = merged.filter((it) => { if (seen.has(it.id)) return false; seen.add(it.id); return true })
    if (existing) clearTimeout(existing.timer)
    stepwiseHits.set(sessionId, {
      items: dedup,
      turn,
      timer: setTimeout(() => { stepwiseHits.delete(sessionId) }, INJECT_TTL_MS),
    })
    try { ctx.logger?.info?.(`[dsh-prompt-inject] 条件命中 ${sessionId} @ ${cond} (turn=${turn})，${items.length} 条入队`) } catch {}
  }

  // ── 条件监听器 ──
  // 1) 思考之后：检测 reasoning 结束（block-end reasoning）或首个 text-delta。
  //    同时按文档《DSH提示词遵循度监测》§5：用 options.messages（模型真实收到的请求
  //    消息，GenerateOptions 契约）计算“窗口内已存在的提示词 id 集合” windowPresent，
  //    供 pre-step 消费做“是否滑出窗口”判断。
  ctx.on('llm/stream', async function* (options: any, next: () => AsyncIterable<any>) {
    const sessionId = options?.sessionId
    const isSessionStep = sessionId && !options?.purpose
    const sid = sessionId ? String(sessionId) : ''
    // 窗口快照：本 step 请求 messages 中已包含哪些启用条目的提示词。
    if (isSessionStep && Array.isArray(options?.messages)) {
      try {
        const present = new Set<string>()
        for (const it of loadPrompts()) {
          const cfg = getStepConfig(sid, it.id)
          if (cfg.stepwise === true && isStillInWindow(options.messages, it.text)) present.add(it.id)
        }
        windowPresent.set(sid, present)
      } catch {}
    }
    let thoughtEnded = false
    for await (const chunk of next()) {
      if (isSessionStep && !thoughtEnded && chunk && typeof chunk === 'object') {
        if (chunk.type === 'block-end' && (chunk.blockType === 'reasoning' || chunk.block?.blockType === 'reasoning')) thoughtEnded = true
        else if (chunk.type === 'text-delta') thoughtEnded = true
        if (thoughtEnded) queueStepwise(sid, 'thinking-end', currentTurn.get(sid))
      }
      // 永远原样透传（含 finish），绝不 yield 改写/新建对象。
      yield chunk
    }
  })

  // 2) 工具调用后：tools/post-execute。
  ctx.on('tools/post-execute', async (exec: any, _result: any, next: () => Promise<any>) => {
    if (exec?.name) queueStepwise(exec?.agent?.id, `tool-post:${exec.name}`, currentTurn.get(String(exec?.agent?.id)))
    return next()
  })

  // 3) 本轮结束：丢弃该会话逐步队列（本轮内消费语义）。
  ctx.on('agent/turn-stopping', async (payload: any) => {
    const sessionId = payload?.agent?.id
    if (!sessionId) return
    const sw = stepwiseHits.get(sessionId)
    if (sw && sw.turn === payload?.turn) {
      clearTimeout(sw.timer)
      stepwiseHits.delete(sessionId)
      try { ctx.logger?.info?.(`[dsh-prompt-inject] 本轮结束丢弃 ${sessionId} (turn=${sw.turn})，${sw.items.length} 条`) } catch {}
    }
  })

  // ── agent/pre-step：消费队列 → 若提示词不在窗口中则注入一次 ──
  ctx.on('agent/pre-step', async (payload: any, next: () => Promise<any>) => {
    try {
      const agentId = payload?.agent?.id
      if (!agentId) return next()
      const turn = typeof payload?.turn === 'number' ? payload.turn : undefined
      // 轮次开始检测：turn 戳变化（含进程内首次见到该会话）= 用户消息后的第一个 step。
      // 入队后同一次 pre-step 立即消费 → 语义即「轮次开始时（用户消息后）注入」。
      const prevTurn = currentTurn.get(String(agentId))
      if (turn !== undefined && prevTurn !== turn) {
        queueStepwise(String(agentId), 'turn-start', turn)
      }
      if (turn !== undefined) currentTurn.set(String(agentId), turn)
      const pending = pendingInjections.get(String(agentId))
      let sw = stepwiseHits.get(String(agentId))
      // 惰性丢弃兜底：逐步队列跨轮 → 过期。
      if (sw && turn !== undefined && sw.turn !== turn) {
        clearTimeout(sw.timer)
        stepwiseHits.delete(String(agentId))
        try { ctx.logger?.info?.(`[dsh-prompt-inject] 过期丢弃 ${agentId} (排队 turn=${sw.turn} ≠ 当前 turn=${turn})，${sw.items.length} 条`) } catch {}
        sw = undefined
      }
      if (!pending && !sw) return next()
      if (pending) clearTimeout(pending.timer)
      if (sw) clearTimeout(sw.timer)
      pendingInjections.delete(String(agentId))
      stepwiseHits.delete(String(agentId))
      const decision = await next()
      if (!decision || decision.kind !== 'enter') return decision
      const messages = Array.isArray(decision.messages) ? decision.messages : []
      // 窗口判断：用最近一次 llm/stream 的 options.messages 快照（windowPresent，模型真实
      // 收到的请求消息）——decision.messages 只是本轮 claimed，不含历史，用它判断会永远 false。
      const present = windowPresent.get(String(agentId))
      const inWindow = (it: PromptItem): boolean => {
        if (present && present.has(it.id)) return true
        // 无窗口快照时退化为本 step 消息检查（至少不误注入）。
        return isStillInWindow(messages, it.text)
      }
      let injected = 0
      // 手动一次性注入：提示词不在窗口才注入（补一次提醒）。
      if (pending && !inWindow(pending.item)) {
        messages.push(makeUserMessage(pending.item.text))
        injected += 1
      }
      // 逐步注入：forceInject=true → 条件命中即注入；否则 → 仅滑出窗口才注入。
      // forceInject 取【该会话】的 StepConfig（逐步配置按会话隔离）。
      if (sw) {
        for (const it of sw.items) {
          const cfg = getStepConfig(String(agentId), it.id)
          if (cfg.forceInject === true || !inWindow(it)) {
            messages.push(makeUserMessage(it.text))
            injected += 1
          }
        }
      }
      if (injected > 0) {
        try { ctx.logger?.info?.(`[dsh-prompt-inject] 已注入 ${agentId}（${injected} 条）`) } catch {}
      }
      return { kind: 'enter', messages }
    } catch (err: any) {
      try { ctx.logger?.warn?.(`[dsh-prompt-inject] 注入监听器异常: ${err?.message ?? err}`) } catch {}
      return next()
    }
  })

  ctx.inject(['webServer'], (webCtx: any) => {
    const webServer = webCtx.webServer
    const disposers: Array<() => void> = []
    // 单条路由注册失败不应中断其余路由（webserver 对 duplicate route 直接 throw）。
    const safeRegister = (route: any) => {
      try {
        disposers.push(webServer.register(route))
      } catch (err: any) {
        try { webCtx.logger?.warn?.(`[dsh-prompt-inject] 路由注册失败 ${route.kind} ${route.path}: ${err?.message ?? err}`) } catch {}
      }
    }

    // ── 提示词列表/新增：GET|POST /prompts（一个 exact 路由，method 分流）──
    // 注意：webserver 对重复 (kind, path) 直接 throw，同一 path 的 GET/POST 不可分两个
    // register（否则第二个抛异常中断整个注册回调，后续路由全灭）。
    safeRegister({
      kind: 'exact',
      path: `${PLUGIN_BASE}/prompts`,
      handler: async (req: any, res: any) => {
        try {
          if (req.method === 'GET') {
            // 若带 ?sessionId= 则返回【该会话】的逐步注入配置（缺省全关），否则返回全局列表。
            let sessionId: string | undefined
            try {
              sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId') || undefined
            } catch {}
            const items = loadPrompts().map((it) => {
              if (!sessionId) return it
              const cfg = getStepConfig(sessionId, it.id)
              return { ...it, stepwise: cfg.stepwise, stepwiseConditions: cfg.conditions, forceInject: cfg.forceInject }
            })
            // 列表排序：置顶优先；置顶组内/未置顶组内都按修改时间倒序（map 产生新数组，sort 不污染缓存）
            items.sort((a, b) => {
              const p = (b.pinned === true ? 1 : 0) - (a.pinned === true ? 1 : 0)
              if (p !== 0) return p
              return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
            })
            sendJson(res, 200, { ok: true, items })
            return
          }
          if (req.method === 'POST') {
            const body = await readBody(req)
            const text = typeof body.text === 'string' ? body.text.trim() : ''
            if (!text) { sendJson(res, 400, { ok: false, error: 'text 不能为空' }); return }
            const items = loadPrompts()
            const item: PromptItem = { id: newId(), text, updatedAt: new Date().toISOString() }
            items.push(item)
            savePrompts(items)
            sendJson(res, 200, { ok: true, item })
            return
          }
          res.writeHead(405); res.end()
        } catch (err: any) {
          sendJson(res, 500, { ok: false, error: String(err?.message || err) })
        }
      },
    })

    // ── 编辑 / 删除提示词：PUT|DELETE /prompts/{id} ──
    // prefix path 必须**不带尾部斜杠**：webserver 匹配用 pathname.startsWith(prefix + '/')，
    // 带斜杠会变成双斜杠永不匹配（PUT/DELETE 全 404）。
    safeRegister({
      kind: 'prefix',
      path: `${PLUGIN_BASE}/prompts`,
      handler: async (req: any, res: any) => {
        if (req.method !== 'PUT' && req.method !== 'DELETE') { res.writeHead(405); res.end(); return }
        try {
          const id = promptIdFromUrl(req)
          if (!id) { sendJson(res, 400, { ok: false, error: '缺少提示词 id' }); return }
          const items = loadPrompts()
          const idx = items.findIndex((it) => it.id === id)
          if (idx < 0) { sendJson(res, 404, { ok: false, error: '提示词不存在' }); return }
          if (req.method === 'DELETE') {
            savePrompts(items.filter((it) => it.id !== id))
            // 删除提示词时一并清理所有会话的逐步配置（避免内存残留）
            for (const m of sessionStepConfig.values()) m.delete(id)
            sendJson(res, 200, { ok: true })
            return
          }
          // PUT：编辑（文本全局共享；逐步注入配置按 sessionId 维度写运行期内存）
          const body = await readBody(req)
          const text = typeof body.text === 'string' ? body.text.trim() : ''
          if (!text) { sendJson(res, 400, { ok: false, error: 'text 不能为空' }); return }
          const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
          const stepwise = typeof body.stepwise === 'boolean' ? body.stepwise : false
          const forceInject = typeof body.forceInject === 'boolean' ? body.forceInject : false
          const stepwiseConditions = Array.isArray(body.stepwiseConditions)
            ? body.stepwiseConditions.filter((s: unknown): s is string => typeof s === 'string')
            : []
          // 置顶是列表管理属性，持久化；body 未带时保留原值（不被开关/条件/编辑等其他 PUT 冲掉）
          const pinned = typeof body.pinned === 'boolean' ? body.pinned : (items[idx].pinned === true)
          // 只有正文变化才刷新修改时间（置顶/开关/条件操作不影响排序时间戳）
          const textChanged = text !== items[idx].text
          items[idx] = { ...items[idx], text, pinned, updatedAt: textChanged ? new Date().toISOString() : items[idx].updatedAt }
          savePrompts(items)
          // 写入【该会话】的逐步配置（无 sessionId 则缺省落到空串键——前端必带，正常不会）
          setStepConfig(sessionId, id, { stepwise, conditions: stepwiseConditions, forceInject })
          // 回包带该会话配置，供前端即时刷新
          const cfg = getStepConfig(sessionId, id)
          sendJson(res, 200, { ok: true, item: { ...items[idx], stepwise: cfg.stepwise, stepwiseConditions: cfg.conditions, forceInject: cfg.forceInject } })
        } catch (err: any) {
          sendJson(res, 500, { ok: false, error: String(err?.message || err) })
        }
      },
    })

    // ── 注入排队：POST /inject {sessionId, promptId} ──
    // 手动一次性注入：下一次该会话 pre-step 时，若提示词不在窗口中则注入一次。
    safeRegister({
      kind: 'exact',
      path: `${PLUGIN_BASE}/inject`,
      handler: async (req: any, res: any) => {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        try {
          const body = await readBody(req)
          const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
          const promptId = typeof body.promptId === 'string' ? body.promptId : ''
          if (!sessionId) { sendJson(res, 400, { ok: false, error: 'sessionId 不能为空' }); return }
          if (!promptId) { sendJson(res, 400, { ok: false, error: 'promptId 不能为空' }); return }
          const item = loadPrompts().find((it) => it.id === promptId)
          if (!item) { sendJson(res, 404, { ok: false, error: '提示词不存在' }); return }

          // 覆盖式排队：同一会话再次注入会替换旧队列（只保留最新）。
          const existing = pendingInjections.get(sessionId)
          if (existing) clearTimeout(existing.timer)
          pendingInjections.set(sessionId, {
            item,
            timer: setTimeout(() => {
              const cur = pendingInjections.get(sessionId)
              if (cur && cur.item.id === item.id) pendingInjections.delete(sessionId)
            }, INJECT_TTL_MS),
          })
          try { ctx.logger?.info?.(`[dsh-prompt-inject] 已排队 ${sessionId} -> "${item.text}"`) } catch {}
          sendJson(res, 200, { ok: true, queued: true, sessionId })
        } catch (err: any) {
          sendJson(res, 500, { ok: false, error: String(err?.message || err) })
        }
      },
    })

    // ── 主题偏好：GET /theme → { preference: light|dark|system } ──
    // 注入页据此跟随 dsh 外观（settings ui-theme），system 由页面端 matchMedia 解析。
    safeRegister({
      kind: 'exact',
      path: `${PLUGIN_BASE}/theme`,
      handler: (req: any, res: any) => {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
        sendJson(res, 200, { ok: true, preference: readThemePreference(ctx) })
      },
    })

    // ── 管理页面：GET /page ──
    safeRegister({
      kind: 'exact',
      path: `${PLUGIN_BASE}/page`,
      handler: (req: any, res: any) => {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(PANEL_PAGE_HTML)
      },
    })

    return () => { for (const d of disposers) { try { d() } catch {} } }
  })
}

export { apply, inject, name }
