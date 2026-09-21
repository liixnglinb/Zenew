// 探测翻面失败原因：检查焦点与监听器状态
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

await evalJs(`location.hash = '/vocab'`)
await sleep(800)
await evalJs(`location.hash = '/vocab/cet4'`)
await sleep(2200)
console.log('phase 前状态:', await evalJs(`document.body.innerText.includes('先回忆词义')`))
// 点击「显示答案」按钮而不是空格
const clicked = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('显示答案'))
  if (btn) { btn.click(); return 'clicked' } return 'no-btn'
})()`)
console.log('点击显示答案:', clicked)
await sleep(800)
console.log('翻面后 word-sense:', await evalJs(`!!document.querySelector('.word-sense')`))
console.log('翻面后 grade-row:', await evalJs(`!!document.querySelector('.grade-row')`))
console.log('body 摘要:', (await evalJs(`document.body.innerText.slice(0, 350)`))?.replace(/\n/g, ' | '))
process.exit(0)
