// 定位 React 崩溃页：先装错误监听，再逐页导航
const BASE = 'http://127.0.0.1:9222'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = await (await fetch(`${BASE}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && /tauri|localhost/.test(t.url))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value

// 重载页面拿干净状态，第一时间装监听
await evalJs(`location.reload()`)
await sleep(2500)
await evalJs(`window.__errs=[]; window.addEventListener('error', e => window.__errs.push('E:' + e.message + ' @ ' + (e.filename||'') + ':' + e.lineno)); window.addEventListener('unhandledrejection', e => window.__errs.push('P:' + String(e.reason).slice(0,200)))`)

for (const h of ['/today', '/vocab', '/review', '/dict']) {
  await evalJs(`location.hash = '${h}'`)
  await sleep(1800)
  const len = await evalJs(`document.getElementById('root')?.innerHTML.length`)
  const errs = await evalJs(`JSON.stringify(window.__errs)`)
  console.log(`${h}: rootLen=${len} errs=${errs}`)
  if (len === 0) break
}
process.exit(0)
