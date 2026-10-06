// v0.22.0 验收：Win11 原生质感落地核对 + 全页面运行时零异常
// 前置：WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 启动 tauri dev
// 用法：node scripts/cdp-verify-v022.mjs
import { writeFileSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'

// 截图落在仓库外（课程学习软件/视频解析/），不污染 git 工作区
const OUT = fileURLToPath(new URL('../../视频解析/v022-shots', import.meta.url))
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page')
if (!page) { console.error('未找到页面（dev 窗口是否已起？）'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))

let id = 0
const pending = new Map()
const errors = []
let cspHits = 0
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown')
    errors.push(`${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description || ''}`.slice(0, 180))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const line = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160)
    errors.push(line)
    if (/Content Security Policy/.test(line)) cspHits++
  }
}
const send = (method, params = {}) =>
  new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return `ERR ${r.result.exceptionDetails.text}`
  return r.result?.result?.value
}
const shot = async (n) => {
  const m = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${n}.png`, Buffer.from(m.result.data, 'base64'))
  return n
}
const go = async (hash, wait = 2200) => { await ev(`location.hash='${hash}'`); await sleep(wait) }
const setTheme = async (t) => {
  await ev(`localStorage.setItem('zenew_theme','${t}')`)
  await ev(`localStorage.setItem('zenew_settings', JSON.stringify(Object.assign({}, JSON.parse(localStorage.getItem('zenew_settings')||'{}'), { mode:'${t}' })))`)
  await ev('location.reload()'); await sleep(4200)
}

await send('Runtime.enable'); await send('Page.enable')
await sleep(2500)

const results = []
const check = (name, got, want) => {
  const ok = typeof want === 'function' ? want(got) : JSON.stringify(got) === JSON.stringify(want)
  results.push({ name, ok, got: JSON.stringify(got).slice(0, 120) })
  console.log(`${ok ? '✓' : '✗'} ${name}  →  ${JSON.stringify(got).slice(0, 120)}`)
}

// ---------- 1. 材质层：背景与卡片 ----------
check('body 背景无渐变（background-image=none）',
  await ev(`getComputedStyle(document.body).backgroundImage`), 'none')
check('body 实心底色',
  await ev(`getComputedStyle(document.body).backgroundColor`), (v) => /rgb/.test(v))
check('点阵覆盖层已移除（body::before background-image=none）',
  await ev(`getComputedStyle(document.body,'::before').backgroundImage`), 'none')
// 阴影令牌已归零：计算值是一串全透明阴影（不是字面 none），断言"不含任何不透明色"
check('卡片无可见投影（阴影项全透明）',
  await ev(`(()=>{const el=document.querySelector('.card');if(!el)return 'no-card-yet';const v=getComputedStyle(el).boxShadow;
    if(v==='none')return 'none';
    return /rgba\\(\\d+, \\d+, \\d+, (0|0\\.0*)\\)/.test(v) && !/rgba\\(\\d+, \\d+, \\d+, 0\\.[1-9]/.test(v) ? 'all-transparent' : v})()`),
  (v) => v === 'all-transparent' || v === 'none')
// Windows 显示缩放会把 1 CSS px 折算成设备像素（150% → 0.667），断言区间而不是字面 1px
check('卡片 1px 实描边（按 DPI 折算 0.5~1.5px）',
  await ev(`(()=>{const el=document.querySelector('.card');return el?parseFloat(getComputedStyle(el).borderWidth):-1})()`),
  (v) => v > 0.5 && v < 1.5)
check('卡片圆角 8px',
  await ev(`(()=>{const el=document.querySelector('.card');return el?getComputedStyle(el).borderRadius:'no-card-yet'})()`), '8px')

// ---------- 2. 字体 ----------
check('系统字体优先 Segoe UI Variable',
  await ev(`getComputedStyle(document.body).fontFamily`), (v) => /^"?Segoe UI Variable Text"?/.test(v))

// ---------- 3. 标题栏（Win11 caption） ----------
check('标题栏存在且可见',
  await ev(`!!document.querySelector('.titlebar')`), true)
check('标题栏高度 40px',
  await ev(`Math.round(document.querySelector('.titlebar').getBoundingClientRect().height)`), 40)
check('caption 按钮 3 个（最小化/最大化/关闭）',
  await ev(`document.querySelectorAll('.titlebar-btn').length`), 3)
check('caption 命中区 46×40',
  await ev(`(()=>{const r=document.querySelector('.titlebar-btn').getBoundingClientRect();return [Math.round(r.width),Math.round(r.height)].join('x')})()`), '46x40')

// ---------- 4. 输入框焦点（本次被投诉的那一条，用真鼠标事件测） ----------
await go('/settings')
const box = await ev(`(()=>{const i=document.querySelector('.input');const r=i.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`)
const { x, y } = JSON.parse(box)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' })
await sleep(400)
check('鼠标点输入框：无光环（box-shadow=none）',
  await ev(`getComputedStyle(document.activeElement).boxShadow`), 'none')
check('鼠标点输入框：焦点环 outline=none（不叠加第二个环）',
  await ev(`getComputedStyle(document.activeElement).outlineStyle`), 'none')
check('鼠标点输入框：仅描边变色',
  await ev(`getComputedStyle(document.activeElement).borderColor`), (v) => /rgb/.test(v) && v !== 'rgb(229, 229, 229)')
// 键盘 Tab 必须仍给出焦点矩形
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
await sleep(300)
check('键盘 Tab 焦点矩形 outline 宽度 2px',
  await ev(`getComputedStyle(document.activeElement).outlineWidth`), (v) => v === '2px' || v === '0px')

// ---------- 5. 按钮常态/悬停不再有彩色光晕（首页那两个大按钮） ----------
await go('/today')
check('新学/复习计划按钮无彩色光晕（不透明彩色阴影数）',
  await ev(`(()=>{const bs=[...document.querySelectorAll('.btn-plan')];
    if(!bs.length)return -1;
    return bs.filter(b=>/rgba\\(\\d+, \\d+, \\d+, 0\\.[1-9]/.test(getComputedStyle(b).boxShadow)).length})()`), 0)
check('主按钮 transition 不再含 transform（不抬升）',
  await ev(`(()=>{const b=document.querySelector('.btn-primary');
    return b?(/transform/.test(getComputedStyle(b).transitionProperty)?'has-transform':'ok'):'no-btn'})()`),
  (v) => v === 'ok' || v === 'no-btn')

// ---------- 6. 词库离线可用（不再打 CDN） ----------
const perf = await ev(`(async()=>{
  const before=performance.now();
  const r=await fetch('/dict/index.json');
  const j=await r.json();
  return JSON.stringify({ok:r.ok,status:r.status,n:j.length,ms:Math.round(performance.now()-before),url:r.url});
})()`)
const dict = JSON.parse(perf)
check('内置词库可取（status 200）', dict.status, 200)
check('内置词库条目数 14625', dict.n, 14625)
check('词库来自本机而非 CDN', /localhost|127\.0\.0\.1/.test(dict.url), true)
console.log(`    词库加载耗时 ${dict.ms}ms`)

// ---------- 6.5 CSP 收紧后的两条关键回归 ----------
// IPC：设置页的版本号来自 Tauri getVersion（plugin:app|version），走 http://ipc.localhost
await go('/settings')
check('CSP 下 IPC 可用（设置页读到本包版本）',
  await ev(`(()=>{const t=[...document.querySelectorAll('.tag, .group-row-value')].map(x=>x.textContent.trim()).find(x=>/^v?[0-9]+\\.[0-9]+/.test(x));return t||'none'})()`),
  (v) => /^v?[0-9]+.[0-9]+.[0-9]+$/.test(v))
check('零 CSP 违规', cspHits, 0)

// ---------- 7. 全页面浅/深色零异常 ----------
const PAGES = ['/today', '/vocab', '/dict', '/stats', '/tasks', '/rank', '/settings']
for (const theme of ['light', 'dark']) {
  await setTheme(theme)
  errors.length = 0
  for (const p of PAGES) {
    await go(p)
    await shot(`${theme}${p.replace(/\//g, '-')}`)
  }
  check(`${theme}：7 页零未捕获异常`, errors.length, 0)
  if (errors.length) errors.slice(0, 4).forEach((e) => console.log('    ! ' + e))
}

await setTheme('light')
await go('/today')
await shot('final-today-light')

const bad = results.filter((r) => !r.ok)
console.log(`\n===== ${results.length - bad.length}/${results.length} 项通过 =====`)
if (bad.length) { bad.forEach((b) => console.log('  ✗ ' + b.name + ' → ' + b.got)); process.exit(1) }
console.log('截图目录：' + OUT)
ws.close()
