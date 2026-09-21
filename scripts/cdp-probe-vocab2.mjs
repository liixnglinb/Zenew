// 深探测：DOM 树是否存在 / React 是否崩溃
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

console.log('root html len:', await evalJs(`document.getElementById('root')?.innerHTML.length`))
console.log('root 前 300:', await evalJs(`document.getElementById('root')?.innerHTML.slice(0, 300)`))
console.log('title:', await evalJs(`document.title`))
console.log('url:', await evalJs(`location.href`))
// 捕获未处理错误
await evalJs(`window.__errs = []; window.addEventListener('error', e => window.__errs.push(String(e.message)))`)
await evalJs(`location.hash = '/vocab'`)
await sleep(1500)
console.log('vocab html len:', await evalJs(`document.getElementById('root')?.innerHTML.length`))
console.log('errs:', await evalJs(`JSON.stringify(window.__errs)`))
console.log('body:', (await evalJs(`document.body.innerText.slice(0, 200)`)))
process.exit(0)
