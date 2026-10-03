// 真机验收（带假会话）：注入 /me 假响应 + 本地 token，进入主界面逐页截图
// 只 mock 网络层，本地 SQLite 与真实 UI 全部照旧；不作答、不写库
import { writeFileSync, mkdirSync } from 'fs'

const OUT = 'C:/Users/李星历/Desktop/课程学习软件/视频解析/app-shots'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page')
if (!page) { console.error('未找到页面'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
const errors = []
const consoleErr = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') errors.push(`${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description || ''}`.slice(0, 260))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErr.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
}
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.exceptionDetails ? `ERR ${r.result.exceptionDetails.text}` : r.result?.result?.value
}
const shot = async (name) => {
  const m = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(m.result.data, 'base64'))
}

await send('Runtime.enable')
await send('Page.enable')

// 注入：本地会话 token + /me 与其它鉴权接口的假响应
const MOCK = `
localStorage.setItem('zenew_token','verify-dummy');
const _f = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (url.endsWith('/me')) {
    return Promise.resolve(new Response(JSON.stringify({email:'verify@local',used_tokens:0,quota_tokens:0,balance_tokens:0}), {status:200, headers:{'Content-Type':'application/json'}}));
  }
  if (url.includes('/billing/') || url.includes('/gen/') || url.includes('/courses')) {
    return Promise.resolve(new Response(JSON.stringify({courses:[],cards:[],orders:[]}), {status:200, headers:{'Content-Type':'application/json'}}));
  }
  return _f(input, init);
};
`
await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK })
await evalJs(`localStorage.setItem('zenew_theme','light')`)
await evalJs('location.reload()')
await sleep(4000)

const routes = [
  ['#/today', 'light-today', 2500],
  ['#/vocab', 'light-vocab', 2500],
  ['#/stats', 'light-stats', 2800],
  ['#/tasks', 'light-tasks', 2500],
  ['#/rank', 'light-rank', 2500],
  ['#/settings', 'light-settings', 2500],
  ['#/review', 'light-study', 3500],
]
for (const [h, n, w] of routes) {
  await evalJs(`location.hash = '${h}'`)
  await sleep(w)
  await shot(n)
  const t = await evalJs(`document.body.innerText.replace(/\\s+/g,' ').slice(0,110)`)
  console.log(`${n}: ${t}`)
}

// 深色
await evalJs(`localStorage.setItem('zenew_theme','dark')`)
await evalJs('location.reload()')
await sleep(4000)
for (const [h, n, w] of [['#/today', 'dark-today', 2500], ['#/stats', 'dark-stats', 2800], ['#/settings', 'dark-settings', 2500], ['#/review', 'dark-study', 3500]]) {
  await evalJs(`location.hash = '${h}'`)
  await sleep(w)
  await shot(n)
}

console.log('\n未捕获异常:', errors.length ? errors : '无 ✓')
console.log('console.error:', consoleErr.length ? [...new Set(consoleErr)] : '无 ✓')
process.exit(0)
