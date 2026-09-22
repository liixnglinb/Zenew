// 截两张图：正面 / 翻面背面（截图消息带 sessionId，需按 id 匹配）
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

const shot = async (name) => {
  const m = await send('Page.captureScreenshot', { format: 'png' })
  if (!m.result?.data) { console.log('shot fail', JSON.stringify(m).slice(0, 200)); return }
  const { writeFileSync } = await import('fs')
  writeFileSync(`C:/Users/李星历/Desktop/课程学习软件/Zenew/release/ui-${name}.png`, Buffer.from(m.result.data, 'base64'))
  console.log('saved', name)
}
await send('Page.enable')
await sleep(400)
await shot('front')
await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('button')].find(x => x.textContent.includes('显示答案'))?.click()` })
await sleep(900)
await shot('back')
process.exit(0)
