// 探测复习/查词页现状
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

await evalJs(`location.hash = '/review'`)
await sleep(2000)
console.log('hash:', await evalJs(`location.hash`))
console.log('body 前 400 字:', (await evalJs(`document.body.innerText.slice(0, 400)`)))
await evalJs(`location.hash = '/dict'`)
await sleep(2500)
console.log('dict body 前 300 字:', (await evalJs(`document.body.innerText.slice(0, 300)`)))
console.log('dict input 有无:', await evalJs(`!!document.querySelector('.dict-search input')`))
process.exit(0)
