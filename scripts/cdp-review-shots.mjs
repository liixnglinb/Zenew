// 按应用默认窗口尺寸（1280×820）截图，用于设计评审
import { writeFileSync, mkdirSync } from 'fs'

const OUT = 'C:/Users/李星历/Desktop/课程学习软件/视频解析/review-shots'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let page = null
for (let i = 0; i < 40 && !page; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
    page = list.find((t) => t.type === 'page')
  } catch {
    await sleep(3000)
  }
}
if (!page) { console.error('CDP 未就绪'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value
const shot = async (name) => {
  const m = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(m.result.data, 'base64'))
}

await send('Runtime.enable')
await send('Page.enable')

// 窗口尺寸信息
const size = await evalJs('({w: innerWidth, h: innerHeight, dpr: devicePixelRatio})')
console.log('WebView 尺寸:', JSON.stringify(size))

const MOCK = `
localStorage.setItem('zenew_token','review-dummy');
const _f = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (url.endsWith('/me')) return Promise.resolve(new Response(JSON.stringify({email:'review@local'}), {status:200, headers:{'Content-Type':'application/json'}}));
  if (url.includes('/billing/') || url.includes('/gen/') || url.includes('/courses')) return Promise.resolve(new Response(JSON.stringify({courses:[]}), {status:200, headers:{'Content-Type':'application/json'}}));
  return _f(input, init);
};`
await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK })
await evalJs(`localStorage.setItem('zenew_theme','light')`)
await evalJs('location.reload()')
await sleep(4000)

for (const [h, n, w] of [
  ['#/today', 'today', 2500],
  ['#/vocab', 'vocab', 2500],
  ['#/stats', 'stats', 2600],
  ['#/tasks', 'tasks', 2400],
  ['#/rank', 'rank', 2400],
  ['#/settings', 'settings', 2400],
  ['#/review', 'study', 3200],
]) {
  await evalJs(`location.hash = '${h}'`)
  await sleep(w)
  await shot(n)
}
console.log('截图完成 →', OUT)
process.exit(0)
