// 真机验收：连接已启动的 Zenew（WebView2 开 --remote-debugging-port=9222），逐页截图并收集运行时错误
// 用法：先以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 启动 Zenew.exe，再 node scripts/cdp-verify-sky.mjs
import { writeFileSync, mkdirSync } from 'fs'

const OUT = 'C:/Users/李星历/Desktop/课程学习软件/视频解析/app-shots'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page')
if (!page) { console.error('未找到页面，检查 9222 调试端口'); process.exit(1) }
console.log('已连接:', page.url)

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
const errors = []
const consoleErr = []

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    errors.push(`${d.text} ${d.exception?.description || ''}`.slice(0, 300))
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErr.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 220))
  }
}
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return `ERR: ${r.result.exceptionDetails.text}`
  return r.result?.result?.value
}
const shot = async (name) => {
  const m = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(m.result.data, 'base64'))
  console.log('  截图', name)
}

await send('Runtime.enable')
await send('Page.enable')

const go = async (hash, name, wait = 2200) => {
  await evalJs(`location.hash = '${hash}'`)
  await sleep(wait)
  await shot(name)
  const t = await evalJs(`document.body.innerText.slice(0, 90).replace(/\\n/g, ' | ')`)
  console.log(`  ${hash} →`, t)
}

// ---------- 浅色 ----------
console.log('== 浅色主题 ==')
await evalJs(`localStorage.setItem('zenew_theme','light')`)
await evalJs(`location.reload()`)
await sleep(3500)
const routes = [
  ['#/today', 'light-today'],
  ['#/vocab', 'light-vocab'],
  ['#/stats', 'light-stats'],
  ['#/tasks', 'light-tasks'],
  ['#/settings', 'light-settings'],
  ['#/rank', 'light-rank'],
]
for (const [h, n] of routes) await go(h, n)

// 学习卡（只看题面，不作答，避免写库）
await go('#/review', 'light-study', 3000)

// ---------- 深色 ----------
console.log('== 深色主题 ==')
await evalJs(`localStorage.setItem('zenew_theme','dark')`)
await evalJs(`location.reload()`)
await sleep(3500)
for (const [h, n] of [['#/today', 'dark-today'], ['#/stats', 'dark-stats'], ['#/settings', 'dark-settings']]) await go(h, n)
await go('#/review', 'dark-study', 3000)

// ---------- 结果 ----------
console.log('\n== 运行时错误 ==')
console.log(errors.length ? errors.map((e) => '  ✗ ' + e).join('\n') : '  无未捕获异常 ✓')
console.log('== console.error ==')
console.log(consoleErr.length ? [...new Set(consoleErr)].map((e) => '  ! ' + e).join('\n') : '  无 ✓')
console.log('\n截图目录:', OUT)
process.exit(0)
