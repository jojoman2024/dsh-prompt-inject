// src/host/store.ts — 提示词列表的落盘读写（插件自有数据，不污染会话日志）。
//
// 落盘位置：$DSH_HOME/dsh-prompt-inject/prompts.json。DSH_HOME 缺省 ~/.dsh。
// 重启后由 loadPrompts() 读回；变更随即 writePrompts() 落盘。
// pending（下一次注入）是内存态，不落盘——符合「下一次 step」语义，重启即失。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface PromptItem {
  /** 稳定 id（创建时生成）。 */
  id: string
  /** 提示词正文。 */
  text: string
  /** 最近编辑时间（ISO 字符串）。 */
  updatedAt: string
  /** 置顶（列表管理属性，持久化到 prompts.json；置顶组内仍按 updatedAt 倒序）。 */
  pinned?: boolean
  // 注：逐步注入配置（stepwise / stepwiseConditions / forceInject）自「会话作用域改造」起
  // 不再是全局字段，改为运行期内按会话隔离的 StepConfig（见下方 sessionStepConfig）。
  // 旧 prompts.json 若含这些字段，loadPrompts() 会忽略（重启即全关）。
}

/**
 * 单条提示词在某会话下的「逐步注入」配置（运行期内存，不落盘）。
 * - stepwise        是否启用逐步注入（总闸）
 * - conditions      逐步注入条件（'thinking-end' / 'tool-post:<工具名>'）
 * - forceInject     强制注入开关（stepwise 开启时有效）
 */
export interface StepConfig {
  stepwise: boolean
  conditions: string[]
  forceInject: boolean
}

/** 缺省逐步配置（会话维度查不到时返回：全部关闭）。 */
export const DEFAULT_STEP_CONFIG: StepConfig = { stepwise: false, conditions: [], forceInject: false }

/**
 * 会话作用域的逐步注入配置：sessionId -> (promptId -> StepConfig)。
 * 纯运行期内存储（apply 作用域），重启即空 → 满足「重启/启动逐步注入全关」。
 */
export const sessionStepConfig = new Map<string, Map<string, StepConfig>>()

/** 取某会话某提示词的逐步配置（缺省全关）。 */
export function getStepConfig(sessionId: string | undefined, promptId: string): StepConfig {
  if (!sessionId) return { ...DEFAULT_STEP_CONFIG }
  const m = sessionStepConfig.get(sessionId)
  const c = m && m.get(promptId)
  return c ? { ...c } : { ...DEFAULT_STEP_CONFIG }
}

/** 写入某会话某提示词的逐步配置（不存在的子 Map 自动创建）。 */
export function setStepConfig(sessionId: string | undefined, promptId: string, cfg: StepConfig): void {
  if (!sessionId) return
  let m = sessionStepConfig.get(sessionId)
  if (!m) { m = new Map<string, StepConfig>(); sessionStepConfig.set(sessionId, m) }
  m.set(promptId, { ...cfg })
}

function resolveDataDir(): string {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'dsh-prompt-inject')
}

function resolvePromptsFile(): string {
  return join(resolveDataDir(), 'prompts.json')
}

let cache: PromptItem[] | null = null

/** 读提示词列表（带简单内存缓存，避免每次请求都读盘）。 */
export function loadPrompts(): PromptItem[] {
  if (cache) return cache
  const file = resolvePromptsFile()
  if (!existsSync(file)) {
    cache = []
    return cache
  }
  try {
    const raw = readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw)
    cache = Array.isArray(parsed) ? (parsed as PromptItem[]) : []
  } catch {
    cache = []
  }
  return cache
}

/** 写回提示词列表（先建目录，再原子性写盘更新缓存）。 */
export function savePrompts(items: PromptItem[]): void {
  const dir = resolveDataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = resolvePromptsFile()
  writeFileSync(file, JSON.stringify(items, null, 2), 'utf8')
  cache = items
}

/** 生成稳定 id（时间戳 + 随机后缀，避免碰撞）。 */
export function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
