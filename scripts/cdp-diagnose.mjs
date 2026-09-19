// 挂异常监听，进入 /review，抓取 React 崩溃的真实错误
const tabs = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = tabs.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))

let id = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (ev) => {
  const d = JSON.parse(ev.data)
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id) }
  if (d.method === 'Runtime.exceptionThrown') {
    errors.push('EXCEPTION: ' + JSON.stringify(d.params.exceptionDetails).slice(0, 600))
  }
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
    errors.push('CONSOLE: ' + d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 600))
  }
})
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Runtime.enable')
// 先回 today 再进 review，触发完整挂载
await send('Runtime.evaluate', { expression: `location.hash = '#/today'` })
await sleep(1200)
await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('button')].find(b=>/开始学习/.test(b.textContent))?.click()` })
await sleep(2500)

console.log('hash:', (await send('Runtime.evaluate', { expression: 'location.hash', returnByValue: true })).result.value)
console.log('root:', (await send('Runtime.evaluate', { expression: "document.getElementById('root')?.innerHTML?.length || 0", returnByValue: true })).result.value, 'chars')
console.log('--- 捕获的错误 ---')
for (const e of errors) console.log(e)
if (!errors.length) console.log('（无捕获异常）')
process.exit(0)
