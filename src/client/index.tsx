// src/client/index.tsx — dsh-prompt-inject 客户端。
//
// 在会话头部操作区（conversation.session.header.actions）渲染「注入提示词」按钮；
// 点击后 window.open 打开自包含管理页面，URL 带当前会话 sessionId（首载兜底）。
// 会话切换跟随：该槽是 session 作用域，切换会话时组件以新 props.sessionId 重渲染，
// 这里用 useEffect([sessionId]) 捕获切换，并通过 BroadcastChannel('dsh-prompt-inject')
// 广播给已打开的管理页面，使其注入目标实时跟随前端当前选中的会话。
//
// 注册范式沿用官方 session-log-export：slots.inject 挂起等槽声明就绪，注入组件
// 通过 props.sessionId（session-scope 槽自动提供）拿当前会话；为空时回退用
// sessions 服务取当前选定会话，确保任何布局下都能正确绑定。

import * as React from 'react'

const PLUGIN_BASE = '/plugins/dsh-prompt-inject'
const CHANNEL_NAME = 'dsh-prompt-inject'

let sessionsService: any = null

/** 回退：从 sessions 服务取当前选定会话 id（alpha.4: getSnapshot().current）。 */
function currentSessionId(): string | undefined {
  if (!sessionsService || !sessionsService.list) return undefined
  try {
    const id = sessionsService.list.getSnapshot().current
    if (typeof id === 'string' && id) return id
  } catch {}
  return undefined
}

let bc: BroadcastChannel | null = null

/** 向管理页面广播当前选中会话（同源跨窗口，页面实时跟随）。 */
function broadcastSession(sessionId: string | undefined): void {
  if (!sessionId) return
  try {
    if (!bc) bc = new BroadcastChannel(CHANNEL_NAME)
    bc.postMessage({ type: 'session', sessionId })
  } catch {}
}

/**
 * 官方 IconContextInjectionOutline16 的等价内联实现（会话流「上下文注入」行同款）。
 * primitives 包不发布到 node_modules（Vite 内联进 web-app bundle），第三方 client 只能
 * 从 dist 逐字节提取 SVG path 复刻；viewBox 0 0 16 16，4 条 path，fill=currentColor。
 */
function ContextInjectionIcon(props: any) {
  return React.createElement(
    'svg',
    {
      width: props.size ?? 14,
      height: props.size ?? 14,
      viewBox: '0 0 16 16',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': true,
      style: {
        color: 'var(--dsw-alias-label-primary, #1f2328)',
        flex: 'none',
      },
    },
    React.createElement('path', {
      fill: 'currentColor',
      d: 'M11.9512 1.13281C12.401 1.20666 12.8093 1.34164 13.1738 1.60645C13.4282 1.79137 13.6521 2.01609 13.8369 2.27051C14.1574 2.71187 14.2892 3.21614 14.3506 3.78223C14.4105 4.33532 14.4102 5.02658 14.4102 5.87305V10.0273C14.4102 10.8738 14.4105 11.5651 14.3506 12.1182C14.2892 12.6843 14.1574 13.1885 13.8369 13.6299C13.652 13.8843 13.4282 14.109 13.1738 14.2939C12.7324 14.6146 12.2273 14.7462 11.6611 14.8076C11.1081 14.8675 10.4166 14.8672 9.57031 14.8672H6.43164C5.58533 14.8672 4.89387 14.8675 4.34082 14.8076C3.77474 14.7463 3.27046 14.6144 2.8291 14.2939C2.57453 14.109 2.35003 13.8844 2.16504 13.6299C1.84444 13.1885 1.71272 12.6844 1.65137 12.1182C1.59147 11.5651 1.5918 10.8738 1.5918 10.0273V5.87305C1.5918 5.02655 1.59146 4.33533 1.65137 3.78223C1.71272 3.21606 1.84443 2.71191 2.16504 2.27051C2.35003 2.01596 2.57453 1.79141 2.8291 1.60645C3.19332 1.34202 3.60062 1.20669 4.0498 1.13281V2.56445C3.87191 2.61154 3.74906 2.66836 3.65137 2.73926C3.51583 2.83777 3.3964 2.95726 3.29785 3.09277C3.1794 3.25581 3.09143 3.4856 3.04297 3.93262C2.9931 4.39287 2.99219 4.99529 2.99219 5.87305V10.0273C2.99219 10.905 2.99312 11.5075 3.04297 11.9678C3.09142 12.4147 3.17943 12.6446 3.29785 12.8076C3.3964 12.9431 3.51583 13.0626 3.65137 13.1611C3.81441 13.2795 4.04437 13.3676 4.49121 13.416C4.95142 13.4658 5.55411 13.4668 6.43164 13.4668H9.57031C10.4479 13.4668 11.0505 13.4659 11.5107 13.416C11.9576 13.3675 12.1876 13.2796 12.3506 13.1611C12.4861 13.0626 12.6056 12.9431 12.7041 12.8076C12.8224 12.6446 12.9106 12.4146 12.959 11.9678C13.0088 11.5075 13.0098 10.905 13.0098 10.0273V5.87305C13.0098 4.99532 13.0088 4.39286 12.959 3.93262C12.9105 3.48579 12.8225 3.2558 12.7041 3.09277C12.6056 2.95727 12.4861 2.83778 12.3506 2.73926C12.2527 2.66816 12.1296 2.61064 11.9512 2.56348V1.13281Z',
    }),
    React.createElement('path', {
      fill: 'currentColor',
      d: 'M9.32227 11.4141H4.95508V10.2148H9.32227V11.4141Z',
    }),
    React.createElement('path', {
      fill: 'currentColor',
      d: 'M11.0439 8.90039H4.95508V7.70117H11.0439V8.90039Z',
    }),
    React.createElement('path', {
      fill: 'currentColor',
      d: 'M8.59961 3.75781L9.70996 2.64746L10.5586 3.49609L8.49512 5.55957C8.22173 5.83266 7.77816 5.83285 7.50488 5.55957L5.44141 3.49512L6.28906 2.64746L7.40039 3.75781V1.09668H8.59961V3.75781Z',
    }),
  )
}

function InjectButton(props: any) {
  const [hover, setHover] = React.useState('transparent')
  const sessionId: string | undefined = props.sessionId || currentSessionId()

  // 挂载即广播一次（管理页首载兜底），切换会话时随重渲染再广播（实时跟随）。
  React.useEffect(() => {
    broadcastSession(sessionId)
  }, [sessionId])

  const open = () => {
    const url = sessionId
      ? `${PLUGIN_BASE}/page?sessionId=${encodeURIComponent(sessionId)}`
      : `${PLUGIN_BASE}/page`
    window.open(url, '_blank', 'noopener')
  }

  // 样式对齐同槽官方邻居 agent-preset「标准模式」（conversation.session.header.actions 里的
  // AgentPresetLabel，12px/400/22px 行高；颜色按用户拍板保留 label-primary）：透明背景、
  // 无边框、小圆角胶囊、hover 才出 interactive-bg-hover 背景；icon 在左（上下文注入同款）。
  return React.createElement(
    'button',
    {
      type: 'button',
      title: '注入提示词',
      'aria-label': '注入提示词',
      onClick: open,
      onMouseEnter: () => setHover('var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06))'),
      onMouseLeave: () => setHover('transparent'),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        minHeight: 22,
        padding: '0 6px',
        border: 'none',
        borderRadius: 6,
        background: hover,
        color: 'var(--dsw-alias-label-primary, #1f2328)',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 400,
        lineHeight: '22px',
        whiteSpace: 'nowrap',
        transition: 'background 120ms ease',
      },
    },
    React.createElement(ContextInjectionIcon, { size: 14 }),
    '注入提示词',
  )
}

const name = 'dsh-prompt-inject'
// alpha.4 客户端服务注入：对齐 dsh-history-rewind 的已验证写法
// （slots + sessions + locale + commandUi）。
const inject = ['slots', 'sessions', 'locale', 'commandUi']

function apply(ctx: any): void {
  if (ctx.sessions) sessionsService = ctx.sessions
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.actions',
        id: 'prompt-inject',
        order: 50,
      },
      InjectButton,
    ),
  )
}

export { apply, inject, name }
