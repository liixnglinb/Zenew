// 探测查词页与复习队列构成
const BASE = 'http://127.0.0.1:9222'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = await (await fetch(`${BASE}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && /tauri|localhost/.test(t.url))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value

await evalJs(`location.hash = '/dict'`)
await sleep(2200)
console.log('dict rootLen:', await evalJs(`document.getElementById('root')?.innerHTML.length`))
console.log('dict body:', (await evalJs(`document.body.innerText.slice(0, 260)`))?.replace(/\n/g, ' | '))
// 直接 fetch index.json 看线上是否可用
console.log('fetch index.json:', await evalJs(`fetch('https://lxlrwxs.top/zenew/dict/index.json').then(r => r.status + ' ' + r.headers.get('content-length')).catch(e => 'ERR ' + e.message)`))

await evalJs(`location.hash = '/review'`)
await sleep(1800)
// 翻看队列前 12 张的标签构成
const tags = await evalJs(`(() => {
  const out = []
  for (let i = 0; i < 1; i++) out.push(document.querySelector('.review-kind .tag-mono')?.textContent)
  return out.join(',')
})()`)
console.log('第一张卡标签:', tags)
console.log('course_name:', await evalJs(`document.querySelector('.review-loc')?.textContent`))
process.exit(0)
