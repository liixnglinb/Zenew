const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
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
await evalJs(`location.hash = '#/vocab'`)
await sleep(1800)
const n = await evalJs(`document.querySelectorAll(".metric-row .metric").length`)
console.log('metric count:', n)
const texts = await evalJs(`Array.from(document.querySelectorAll(".metric-row .metric")).map(function(m){ return m.innerText.replace(/\n/g, ":") }).join(" | ")`)
console.log('texts:', texts)
const hl = await evalJs(`(() => { var m = document.querySelector(".metric-hl"); return m ? m.querySelector("b").textContent : "none" })()`)
console.log('hl:', hl)
process.exit(0)
