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
await send('Page.enable')
const shot = async (name) => {
  const m = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('fs')
  writeFileSync(`./release/look-${name}.png`, Buffer.from(m.result.data, 'base64'))
  console.log('saved', name)
}
const pages = [
  ['#/today', 'today'],
  ['#/vocab', 'vocab'],
  ['#/stats', 'stats'],
]
for (const [hash, name] of pages) {
  await evalJs(`location.hash = '${hash}'`)
  await sleep(1800)
  await shot(name)
}
process.exit(0)
