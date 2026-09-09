// src/host/page.ts — 自包含管理页面 HTML（原生 JS，无 React / 无 dsh 运行时）。
//
// 同源新标签继承 dsh web cookie，fetch 不需额外 token。
// 约定（沿用 chat-import 踩坑）：内嵌 <script> 一律用单引号字符串，避免反斜杠
// 转义在「模板字符串 → HTML」链路中丢失导致整段脚本静默失败；交付前用 new Function
// 校验语法（见 host 构建/验证步骤）。

export const PANEL_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>提示词注入</title>
<style>
  :root {
    /* DSH 官方外观 token（light 默认；dark 由 body[data-ds-dark-theme] 覆盖）。
       取值与 style-tokens.md / dsh-client-ui-theme design-platform.css 一致。 */
    --dsw-alias-bg-base: #ffffff;
    --dsw-alias-bg-layer-1: #ffffff;
    --dsw-alias-bg-layer-2: #ffffff;
    --dsw-alias-bg-layer-3: #ffffff;
    --dsw-alias-label-primary: #0f1115;
    --dsw-alias-label-secondary: #61666b;
    --dsw-alias-label-tertiary: #81858c;
    --dsw-alias-label-dimmed: #ebeef2;
    --dsw-alias-border-l1: rgba(0,0,0,0.04);
    --dsw-alias-border-l2: rgba(0,0,0,0.10);
    --dsw-alias-border-l3: rgba(0,0,0,0.12);
    --dsw-alias-border-l4: rgba(0,0,0,0.16);
    --dsw-alias-interactive-bg-hover: rgba(38,49,72,0.06);
    --dsw-alias-interactive-bg-active: rgba(38,49,72,0.10);
    --dsw-alias-interactive-bg-hover-danger: rgba(236,19,19,0.05);
    --dsw-alias-brand-primary: #0f1115;
    --dsw-alias-button-primary-hover: #43454a;
    --dsw-alias-label-primary-foreground: #ffffff;
    --dsw-alias-toast-bg: #353638;
    --dsw-alias-state-error-primary: #ec1313;
    --dsw-alias-state-success-primary: #22c55e;
    --ds-ease: cubic-bezier(0.4, 0, 0.2, 1);
    --ds-font-family-code: 'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei';
    /* 页面旧别名（映射到官方 token）。 */
    --bg: var(--dsw-alias-bg-base);
    --panel: var(--dsw-alias-bg-layer-1);
    --text: var(--dsw-alias-label-primary);
    --sub: var(--dsw-alias-label-secondary);
    --muted: var(--dsw-alias-label-tertiary);
    --border: var(--dsw-alias-border-l3);
    --hover: var(--dsw-alias-interactive-bg-hover);
    --accent: var(--dsw-alias-brand-primary);
    --accent-fg: var(--dsw-alias-label-primary-foreground);
    --danger: var(--dsw-alias-state-error-primary);
  }
  body[data-ds-dark-theme] {
    --dsw-alias-bg-base: #151517;
    --dsw-alias-bg-layer-1: #232324;
    --dsw-alias-bg-layer-2: #2c2c2e;
    --dsw-alias-bg-layer-3: #353638;
    --dsw-alias-label-primary: #f9fafb;
    --dsw-alias-label-secondary: #cfd3d6;
    --dsw-alias-label-tertiary: #adb2b8;
    --dsw-alias-label-dimmed: #43454a;
    --dsw-alias-border-l1: rgba(255,255,255,0.06);
    --dsw-alias-border-l2: rgba(255,255,255,0.12);
    --dsw-alias-border-l3: rgba(255,255,255,0.16);
    --dsw-alias-border-l4: rgba(255,255,255,0.20);
    --dsw-alias-interactive-bg-hover: rgba(255,255,255,0.08);
    --dsw-alias-interactive-bg-active: rgba(255,255,255,0.14);
    --dsw-alias-interactive-bg-hover-danger: rgba(242,90,90,0.15);
    --dsw-alias-brand-primary: #f9fafb;
    --dsw-alias-button-primary-hover: #ebeef2;
    --dsw-alias-label-primary-foreground: #0f1115;
    --dsw-alias-toast-bg: #43454a;
    --dsw-alias-state-error-primary: #f25a5a;
    --dsw-alias-state-success-primary: #22c55e;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 22px;
  }
  /* DSH 签名：超椭圆平滑（引擎支持时生效，不支持则回退普通圆角）。 */
  @supports (corner-shape: superellipse(1.5)) {
    * { corner-shape: superellipse(1.5); }
    .queued, .toast { corner-shape: round; }
  }
  .wrap { display: flex; flex-direction: column; height: 100vh; height: 100dvh; }
  .topbar {
    flex: none;
    padding: 14px max(20px, calc((100% - 860px) / 2));
    border-bottom: 0.5px solid var(--dsw-alias-border-l1);
    background: var(--panel);
    display: flex; align-items: center; gap: 12px;
  }
  .topbar h1 { font-size: 16px; line-height: 24px; margin: 0; font-weight: 600; }
  .topbar .sess {
    margin-left: auto; display: inline-flex; align-items: center;
    height: 28px; padding: 0 10px; border-radius: 14px;
    font-size: 12px; line-height: 18px; color: var(--sub);
    font-family: var(--ds-font-family-code); font-variant-numeric: tabular-nums;
  }
  .composer {
    flex: none;
    padding: 12px max(20px, calc((100% - 860px) / 2));
    border-bottom: 0.5px solid var(--dsw-alias-border-l2);
    background: var(--panel);
    display: flex; gap: 8px; align-items: center;
  }
  textarea#newPrompt {
    flex: 1; min-height: 36px; max-height: 160px; resize: vertical;
    padding: 7px 10px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: 8px;
    background: var(--dsw-alias-bg-layer-2); color: var(--text); font: inherit;
    transition: border-color 120ms var(--ds-ease);
  }
  textarea#newPrompt:focus { outline: none; border-color: var(--accent); }
  textarea#newPrompt::placeholder { color: var(--dsw-alias-label-dimmed); }
  .list { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px 40px; }
  .list > * { max-width: 860px; margin-left: auto; margin-right: auto; }
  .empty { color: var(--muted); text-align: center; padding: 48px 0; font-size: 13px; line-height: 20px; }
  .item {
    border: 0.5px solid var(--border); border-radius: 12px; padding: 16px;
    margin-bottom: 12px; background: var(--panel);
    transition: border-color 120ms var(--ds-ease);
  }
  .item:hover { border-color: var(--dsw-alias-border-l4); }
  .item .text {
    white-space: pre-wrap; word-break: break-word; margin-bottom: 12px;
    max-height: 200px; overflow-y: auto;
  }
  .item .meta { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 18px; color: var(--muted); margin-bottom: 12px; font-variant-numeric: tabular-nums; }
  /* 置顶标识：官方 Tag outline tone（r999 胶囊、11/17、500、0.5px border-l4）。 */
  .pinTag {
    display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px;
    border: 0.5px solid var(--dsw-alias-border-l4); font-size: 11px; line-height: 17px;
    font-weight: 500; color: var(--muted); flex: none;
  }
  .item .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .item textarea.edit {
    width: 100%; min-height: 80px; margin-bottom: 12px; padding: 7px 10px;
    border: 0.5px solid var(--dsw-alias-border-l4); border-radius: 8px;
    background: var(--dsw-alias-bg-layer-2); color: var(--text); font: inherit; resize: vertical;
    transition: border-color 120ms var(--ds-ease);
  }
  .item textarea.edit:focus { outline: none; border-color: var(--accent); }
  button {
    font: inherit; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
    border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 8px; height: 28px;
    padding: 0 12px; background: transparent; color: var(--text);
    transition: background 120ms var(--ds-ease), border-color 120ms var(--ds-ease), transform 120ms var(--ds-ease), opacity 120ms var(--ds-ease);
  }
  button:hover { background: var(--hover); border-color: var(--dsw-alias-border-l4); }
  button:active { background: var(--dsw-alias-interactive-bg-active); transform: translateY(1px); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
  button.primary { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
  button.primary:hover { background: var(--dsw-alias-button-primary-hover); border-color: transparent; }
  button.danger { color: var(--danger); }
  button.danger:hover, button.danger:active { background: var(--dsw-alias-interactive-bg-hover-danger); border-color: transparent; }
  .composer button.primary { height: 36px; border-radius: 10px; padding: 0 16px; font-weight: 500; }
  /* 浮层：官方 Toast 规范——始终深块，两主题一致。 */
  .queued, .toast {
    position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
    background: var(--dsw-alias-toast-bg); color: #f9fafb;
    padding: 10px 16px; border-radius: 14px; font-size: 14px; line-height: 22px;
    box-shadow: 0 0 1px rgba(0,0,0,0.2), 0 0 4px rgba(0,0,0,0.02), 0 12px 32px rgba(0,0,0,0.08);
    z-index: 20;
    animation: piToastIn 200ms var(--ds-ease);
  }
  @keyframes piToastIn {
    from { opacity: 0; transform: translate(-50%, 4px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
  .swBlock { margin-top: 12px; }
  .swToggleRow { display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px; color: var(--text); cursor: pointer; }
  .swToggleRow input, .swGroup input, .swTool input { cursor: pointer; accent-color: var(--accent); }
  .swPanel {
    margin-top: 8px; padding: 12px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px;
    background: var(--dsw-alias-bg-layer-2);
  }
  .swGroup { margin-bottom: 12px; }
  .swGroup:last-of-type { margin-bottom: 0; }
  .swGroup > label { display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px; color: var(--text); cursor: pointer; }
  .swTitle { font-size: 12px; line-height: 16px; color: var(--muted); margin-bottom: 4px; }
  .swTools { display: flex; flex-wrap: wrap; gap: 4px 8px; }
  .swTool {
    display: inline-flex; align-items: center; gap: 6px;
    height: 24px; padding: 0 8px 0 0; border-radius: 8px;
    font-size: 13px; line-height: 20px; color: var(--text); cursor: pointer;
    transition: background 120ms var(--ds-ease);
  }
  .swTool:hover { background: var(--hover); }
  /* 板块标题（面板内一级小节）：比分组标题(.swTitle)高一级。 */
  .swSecTitle { font-size: 13px; line-height: 20px; font-weight: 500; color: var(--text); margin-bottom: 8px; }
  /* 保存条件按钮：条件选择板块末尾动作位。 */
  .swSave { margin-top: 0; }
  /* 强制注入区与「条件选择」板块平级：fiRow 上方 hairline 分隔（label 自适应高度，安全）。 */
  .swSave + .swToggleRow {
    margin-top: 14px; padding-top: 12px;
    border-top: 0.5px solid var(--dsw-alias-border-l1);
  }
  /* 强制注入描述与【选框】左对齐（原 24px 是外层开关标题的缩进，视觉错位）。 */
  .swNote { font-size: 12px; line-height: 18px; color: var(--sub); margin: 8px 0 0 0; }
</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <h1>提示词注入</h1>
    <span class="sess" id="sessLabel"></span>
  </div>
  <div class="composer">
    <textarea id="newPrompt" placeholder="输入提示词，点击保存加入列表…"></textarea>
    <button class="primary" id="saveBtn">保存</button>
  </div>
  <div class="list" id="list"></div>
</div>
<script>
(function () {
  'use strict';
  var BASE = '/plugins/dsh-prompt-inject';

  // ── 主题跟随 dsh 外观：偏好 light|dark|system 来自 host（settings ui-theme），
  //    system 由浏览器 matchMedia 解析（与 dsh 同一浏览器环境，结果一致）；
  //    轮询偏好变化 + 监听系统切换，实时更新 body[data-ds-dark-theme]。 ──
  var themePref = 'system';
  var darkMedia = null;
  try { darkMedia = window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) {}
  function applyTheme() {
    var dark = themePref === 'dark' || (themePref === 'system' && !!(darkMedia && darkMedia.matches));
    if (dark) document.body.setAttribute('data-ds-dark-theme', '');
    else document.body.removeAttribute('data-ds-dark-theme');
  }
  function fetchTheme() {
    fetch(BASE + '/theme').then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && (j.preference === 'light' || j.preference === 'dark' || j.preference === 'system')) {
          if (themePref !== j.preference) { themePref = j.preference; applyTheme(); }
        }
      })
      .catch(function () {});
  }
  if (darkMedia) {
    try { darkMedia.addEventListener('change', applyTheme); } catch (e) {}
  }
  fetchTheme();
  setInterval(fetchTheme, 2000); // 跟随 dsh 设置里外观切换

  // 逐步注入可选的官方工具（用户定稿：仅这 5 个；条件 = 思考之后 thinking-end / 调用后 tool-post:<名>）
  var STEPWISE_TOOLS = ['glob', 'grep', 'pwsh', 'web_search', 'web_fetch'];
  function getSessionId() {
    try {
      return new URLSearchParams(location.search).get('sessionId') || '';
    } catch (e) { return ''; }
  }
  // 注入目标：首载用 URL ?sessionId= 兜底；之后由 BroadcastChannel 实时跟随
  // dsh 前端当前选中的会话（切换会话即更新）。
  var currentSessionId = getSessionId();
  var sessLabel = document.getElementById('sessLabel');
  function updateSessionLabel() {
    sessLabel.textContent = currentSessionId
      ? ('会话 ' + currentSessionId.slice(0, 8) + '…（跟随前端）')
      : '未指定会话';
  }
  updateSessionLabel();
  try {
    var bc = new BroadcastChannel('dsh-prompt-inject');
    bc.onmessage = function (ev) {
      var d = ev.data;
      if (d && d.type === 'session' && typeof d.sessionId === 'string' && d.sessionId) {
        currentSessionId = d.sessionId;
        updateSessionLabel();
        load(currentSessionId); // 切换会话即加载该会话的逐步注入设置
      }
    };
  } catch (e) {}

  function api(path, method, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(BASE + path, opts).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: '响应解析失败' }; });
    });
  }

  var listEl = document.getElementById('list');
  var toastTimer = null;
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, 2200);
  }
  function queuedToast(msg) {
    var t = document.createElement('div');
    t.className = 'queued'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }

  function render(items) {
    listEl.innerHTML = '';
    if (!items || items.length === 0) {
      var e = document.createElement('div');
      e.className = 'empty'; e.textContent = '暂无提示词 — 在上方输入第一条提示词，然后点「保存」。';
      listEl.appendChild(e);
      return;
    }
    items.forEach(function (it, idx) {
      var card = document.createElement('div');
      card.className = 'item';
      var text = document.createElement('div');
      text.className = 'text'; text.textContent = it.text;
      card.appendChild(text);
      var meta = document.createElement('div');
      meta.className = 'meta';
      if (it.pinned === true) {
        var pinTag = document.createElement('span');
        pinTag.className = 'pinTag'; pinTag.textContent = '置顶';
        meta.appendChild(pinTag);
      }
      meta.appendChild(document.createTextNode('更新于 ' + (it.updatedAt || '')));
      card.appendChild(meta);

      var row = document.createElement('div');
      row.className = 'row';

      var injectBtn = document.createElement('button');
      injectBtn.className = 'primary';
      injectBtn.textContent = '注入';
      injectBtn.onclick = function () {
        if (!currentSessionId) { toast('未指定会话，无法注入'); return; }
        injectBtn.disabled = true;
        api('/inject', 'POST', { sessionId: currentSessionId, promptId: it.id })
          .then(function (res) {
            if (res.ok) {
              queuedToast('已排队：下次模型调用注入该提示词');
            } else {
              toast('注入失败：' + (res.error || '未知错误'));
            }
          })
          .catch(function (err) { toast('注入失败：' + err); })
          .then(function () { injectBtn.disabled = false; });
      };

      var editBtn = document.createElement('button');
      editBtn.textContent = '编辑';
      editBtn.onclick = function () {
        var ta = document.createElement('textarea');
        ta.className = 'edit'; ta.value = it.text;
        card.insertBefore(ta, row);
        var save = document.createElement('button');
        save.className = 'primary'; save.textContent = '保存';
        var cancel = document.createElement('button');
        cancel.textContent = '取消';
        row.appendChild(save); row.appendChild(cancel);
        editBtn.disabled = true;
        save.onclick = function () {
          var v = ta.value.trim();
          if (!v) { toast('内容不能为空'); return; }
          // 编辑正文：保留该会话当前已有的逐步配置（不重置）
          api('/prompts/' + it.id, 'PUT', { text: v, stepwise: it.stepwise === true, stepwiseConditions: it.stepwiseConditions || [], forceInject: it.forceInject === true, sessionId: currentSessionId }).then(function (res) {
            if (res.ok) { load(currentSessionId); }
            else { toast('保存失败：' + (res.error || '')); editBtn.disabled = false; }
          });
        };
        cancel.onclick = function () { load(currentSessionId); };
      };

      var delBtn = document.createElement('button');
      delBtn.className = 'danger'; delBtn.textContent = '删除';
      delBtn.onclick = function () {
        if (!confirm('确定删除这条提示词？')) return;
        api('/prompts/' + it.id, 'DELETE').then(function (res) {
          if (res.ok) { load(); } else { toast('删除失败：' + (res.error || '')); }
        });
      };

      var pinBtn = document.createElement('button');
      pinBtn.textContent = it.pinned === true ? '取消置顶' : '置顶';
      pinBtn.onclick = function () {
        pinBtn.disabled = true;
        // 全量字段 PUT（host stepwise 缺省 false，不带会把开关冲掉）；置顶不改修改时间
        api('/prompts/' + it.id, 'PUT', { text: it.text, stepwise: it.stepwise === true, stepwiseConditions: it.stepwiseConditions || [], forceInject: it.forceInject === true, pinned: it.pinned !== true, sessionId: currentSessionId })
          .then(function (res) {
            if (res.ok) { load(currentSessionId); }
            else { toast('置顶失败：' + (res.error || '')); pinBtn.disabled = false; }
          })
          .catch(function () { toast('置顶失败：网络错误'); pinBtn.disabled = false; });
      };

      row.appendChild(injectBtn); row.appendChild(pinBtn); row.appendChild(editBtn); row.appendChild(delBtn);
      card.appendChild(row);
      card.appendChild(buildSwBlock(it, idx === 0));
      listEl.appendChild(card);
    });
  }

  // 逐步注入开关 + 条件多选面板（思考之后 / 工具调用前 / 工具调用后）
  function buildSwBlock(it, showNote) {
    var wrap = document.createElement('div');
    wrap.className = 'swBlock';
    var conds = it.stepwiseConditions || [];

    var toggleRow = document.createElement('label');
    toggleRow.className = 'swToggleRow';
    var toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'swToggle';
    toggle.checked = it.stepwise === true;
    toggleRow.appendChild(toggle);
    toggleRow.appendChild(document.createTextNode('条件注入'));
    wrap.appendChild(toggleRow);

    // 开关描述：只在列表第一个卡片显示（含置顶，谁排在最上面谁显示）
    if (showNote === true) {
      var tgNote = document.createElement('div');
      tgNote.className = 'swNote';
      tgNote.textContent = '打开开关可设置条件自动注入';
      wrap.appendChild(tgNote);
    }

    var panel = document.createElement('div');
    panel.className = 'swPanel';
    panel.style.display = toggle.checked ? '' : 'none';
    // 开关 onChange 立即 PUT（拨动即生效）。失败时回滚 UI 并提示。
    toggle.onchange = function () {
      var on = toggle.checked;
      panel.style.display = on ? '' : 'none';
      api('/prompts/' + it.id, 'PUT', { text: it.text, stepwise: on, stepwiseConditions: conds, sessionId: currentSessionId })
        .then(function (res) {
          if (res.ok) {
            it.stepwise = on;
          } else {
            toggle.checked = !on; panel.style.display = on ? 'none' : '';
            toast('保存失败：' + (res.error || ''));
          }
        })
        .catch(function () {
          toggle.checked = !on; panel.style.display = on ? 'none' : '';
          toast('保存失败：网络错误');
        });
    };

    // 板块标题：条件选择（保存按钮归属此板块）
    var secC = document.createElement('div');
    secC.className = 'swSecTitle'; secC.textContent = '条件选择';
    panel.appendChild(secC);

    // 非工具条件（与「工具调用后」平级的分组）
    var g1 = document.createElement('div');
    g1.className = 'swGroup';
    var t1 = document.createElement('div');
    t1.className = 'swTitle'; t1.textContent = '非工具条件';
    g1.appendChild(t1);
    var nonTools = document.createElement('div');
    nonTools.className = 'swTools';
    var l0 = document.createElement('label');
    l0.className = 'swTool';
    var c0 = document.createElement('input');
    c0.type = 'checkbox'; c0.className = 'swCond'; c0.value = 'turn-start';
    c0.checked = conds.indexOf('turn-start') >= 0;
    l0.appendChild(c0); l0.appendChild(document.createTextNode('轮次开始时'));
    nonTools.appendChild(l0);
    var l1 = document.createElement('label');
    l1.className = 'swTool';
    var c1 = document.createElement('input');
    c1.type = 'checkbox'; c1.className = 'swCond'; c1.value = 'thinking-end';
    c1.checked = conds.indexOf('thinking-end') >= 0;
    l1.appendChild(c1); l1.appendChild(document.createTextNode('思考之后'));
    nonTools.appendChild(l1);
    g1.appendChild(nonTools);
    panel.appendChild(g1);

    // 工具调用后（「工具调用前」已按用户决定移除：pre-execute 决策无附加消息通道，
    // 且工具执行前不存在模型调用，注入无落点）
    var mkToolGroup = function (title, prefix) {
      var g = document.createElement('div');
      g.className = 'swGroup';
      var t = document.createElement('div');
      t.className = 'swTitle'; t.textContent = title;
      g.appendChild(t);
      var tools = document.createElement('div');
      tools.className = 'swTools';
      STEPWISE_TOOLS.forEach(function (tool) {
        var l = document.createElement('label');
        l.className = 'swTool';
        var c = document.createElement('input');
        c.type = 'checkbox'; c.className = 'swCond'; c.value = prefix + ':' + tool;
        c.checked = conds.indexOf(c.value) >= 0;
        l.appendChild(c); l.appendChild(document.createTextNode(tool));
        tools.appendChild(l);
      });
      g.appendChild(tools);
      return g;
    };
    panel.appendChild(mkToolGroup('工具调用后', 'tool-post'));

    // 保存条件按钮：属于「条件选择」板块（板块末尾动作位）
    var save = document.createElement('button');
    save.className = 'primary swSave'; save.textContent = '保存条件';
    save.onclick = function () {
      var checked = panel.querySelectorAll('.swCond:checked');
      var list = [];
      for (var i = 0; i < checked.length; i++) list.push(checked[i].value);
      // 保存条件以开关当前状态为准（开关本身 onChange 已即时落盘，这里保持一致）
      api('/prompts/' + it.id, 'PUT', { text: it.text, stepwise: toggle.checked, forceInject: fiToggle.checked, stepwiseConditions: list, sessionId: currentSessionId })
        .then(function (res) {
          if (res.ok) { toast('条件已保存'); load(currentSessionId); }
          else { toast('保存失败：' + (res.error || '')); }
        });
    };
    panel.appendChild(save);

    // ── 强制注入开关（与「条件选择」板块平级，onChange 即存）──
    var fiRow = document.createElement('label');
    fiRow.className = 'swToggleRow';
    var fiToggle = document.createElement('input');
    fiToggle.type = 'checkbox';
    fiToggle.className = 'swToggle';
    fiToggle.checked = it.forceInject === true;
    fiRow.appendChild(fiToggle);
    fiRow.appendChild(document.createTextNode('强制注入'));
    panel.appendChild(fiRow);

    var fiNote = document.createElement('div');
    fiNote.className = 'swNote';
    fiNote.textContent = '开启强制注入将在所选条件强制触发注入，关闭强制注入只会在提示词滑出记忆窗口时注入。';
    panel.appendChild(fiNote);

    fiToggle.onchange = function () {
      var on = fiToggle.checked;
      api('/prompts/' + it.id, 'PUT', { text: it.text, stepwise: toggle.checked, forceInject: on, stepwiseConditions: conds, sessionId: currentSessionId })
        .then(function (res) {
          if (res.ok) { toast(on ? '强制注入已开启' : '强制注入已关闭'); it.forceInject = on; }
          else { fiToggle.checked = !on; toast('保存失败：' + (res.error || '')); }
        })
        .catch(function () { fiToggle.checked = !on; toast('保存失败：网络错误'); });
    };

    wrap.appendChild(panel);
    return wrap;
  }

  function load(sessionId) {
    var q = sessionId ? ('?sessionId=' + encodeURIComponent(sessionId)) : '';
    api('/prompts' + q, 'GET').then(function (res) {
      if (res.ok) render(res.items);
      else { toast('加载失败：' + (res.error || '')); }
    });
  }

  document.getElementById('saveBtn').onclick = function () {
    var ta = document.getElementById('newPrompt');
    var v = ta.value.trim();
    if (!v) { toast('请输入提示词'); return; }
    api('/prompts', 'POST', { text: v }).then(function (res) {
      if (res.ok) { ta.value = ''; load(currentSessionId); }
      else { toast('保存失败：' + (res.error || '')); }
    });
  };

  load(currentSessionId);
})();
</script>
</body>
</html>`
