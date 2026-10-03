// 深色主题 + 滚动到底部检查（确认底部坞不永久遮挡内容）
import { writeFileSync } from 'fs'
const OUT = 'C:/Users/李星历/Desktop/课程学习软件/视频解析/review-shots'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value
const shot = async (n) => { const m = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${n}.png`, Buffer.from(m.result.data, 'base64')) }

await send('Runtime.enable'); await send('Page.enable')
await evalJs(`localStorage.setItem('zenew_theme','dark')`)
await evalJs('location.reload()')
await sleep(4200)
await evalJs(`location.hash='#/today'`); await sleep(2500); await shot('dark-today')
// 滚到底部，确认底部坞没有永久挡住内容
const info = await evalJs(`(() => { const b=document.querySelector('.appbody'); b.scrollTop = b.scrollHeight; return { top: b.scrollTop, h: b.scrollHeight, client: b.clientHeight } })()`)
await sleep(900); await shot('dark-today-bottom')
console.log('滚动信息:', JSON.stringify(info))
await evalJs(`location.hash='#/stats'`); await sleep(2600); await shot('dark-stats')
await evalJs(`localStorage.setItem('zenew_theme','light')`); await evalJs('location.reload()'); await sleep(4000)
await evalJs(`location.hash='#/today'`); await sleep(2200)
const info2 = await evalJs(`(() => { const b=document.querySelector('.appbody'); b.scrollTop = b.scrollHeight; return { top: b.scrollTop, h: b.scrollHeight, client: b.clientHeight } })()`)
await sleep(900); await shot('light-today-bottom')
console.log('浅色滚动信息:', JSON.stringify(info2))
process.exit(0)
