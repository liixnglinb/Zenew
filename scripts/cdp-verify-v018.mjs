// v0.18.0 真机验收：单词列表（六筛选/排序/两栏/训练坞）+ 词条详情 + 五种训练 + 听写设置
// 用法：先以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 启动 Zenew，再 node scripts/cdp-verify-v018.mjs
import { writeFileSync, mkdirSync } from 'fs'

const OUT = 'C:/Users/李星历/Desktop/课程学习软件/视频解析/v018-shots'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page')
if (!page) { console.error('未找到页面'); process.exit(1) }
console.log('已连接:', page.url)

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
const errors = []
const consoleErr = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') errors.push(`${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description || ''}`.slice(0, 240))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErr.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 180))
}
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.exceptionDetails ? `ERR ${r.result.exceptionDetails.text}` : r.result?.result?.value
}
const shot = async (name) => {
  const m = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(m.result.data, 'base64'))
  console.log('  截图', name)
}
const go = async (hash, name, wait = 2200) => {
  await evalJs(`location.hash = '${hash}'`)
  await sleep(wait)
  await shot(name)
  const t = await evalJs(`document.body.innerText.replace(/\\s+/g,' ').slice(0, 120)`)
  console.log(`  ${hash} → ${t}`)
}

await send('Runtime.enable')
await send('Page.enable')

const MOCK = `
localStorage.setItem('zenew_token','v018-verify');
const _f = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (url.endsWith('/me')) return Promise.resolve(new Response(JSON.stringify({email:'verify@local'}), {status:200, headers:{'Content-Type':'application/json'}}));
  if (url.includes('/billing/') || url.includes('/gen/')) return Promise.resolve(new Response('{}', {status:200, headers:{'Content-Type':'application/json'}}));
  return _f(input, init);
};`
await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK })
await evalJs(`localStorage.setItem('zenew_theme','light')`)
await evalJs('location.reload()')
await sleep(4200)

console.log('== 单词列表 ==')
await go('#/vocab/cet4/words', 'light-wordlist', 3000)
// 六筛选逐个点击，确认页签可用且有内容
const tabCount = await evalJs(`document.querySelectorAll('.wl-tab, [role="tab"], .segmented button').length`)
console.log('  页签/分段控件数:', tabCount)
for (const [label, name] of [['今日', 'light-wl-today'], ['未学习', 'light-wl-new'], ['已斩', 'light-wl-cut']]) {
  const ok = await evalJs(`(() => { const els=[...document.querySelectorAll('button,a')]; const t=els.find(e=>e.textContent.trim()==='${label}'); if(!t) return 'not-found'; t.click(); return 'clicked'; })()`)
  await sleep(1400)
  await shot(name)
  console.log(`  筛选 ${label}: ${ok}`)
}
// 点一行看词条详情
const rowClick = await evalJs(`(() => { const r=document.querySelector('.wl-row, .wl-item, tbody tr'); if(!r) return 'no-row'; r.click(); return 'clicked'; })()`)
await sleep(1500)
await shot('light-worddetail')
console.log('  点开词条:', rowClick, '| 详情面板存在:', await evalJs(`!!document.querySelector('.wl-detail, .word-detail, .wl-panel')`))

console.log('== 五种训练 ==')
for (const mode of ['choice', 'spell', 'dictation', 'listen', 'rush']) {
  await go(`#/vocab/cet4/train/${mode}`, `light-train-${mode}`, 3000)
}
// 听写设置面板
await evalJs(`location.hash = '#/vocab/cet4/train/dictation'`)
await sleep(2200)
const setOk = await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(e=>/设置/.test(e.textContent)||/设置/.test(e.getAttribute('aria-label')||'')); if(!b) return 'no-settings-btn'; b.click(); return 'clicked'; })()`)
await sleep(1200)
await shot('light-dictation-settings')
console.log('  听写设置:', setOk)
const panelInfo = await evalJs(`(() => { const t=document.body.innerText; return { 美音:t.includes('美音'), 英音:t.includes('英音'), 播放次数:t.includes('播放次数'), 播放间隔:t.includes('播放间隔'), 自动播放下一词:t.includes('自动播放下一词'), 开始听写:/开始听写|准备好笔纸/.test(t) } })()`)
console.log('  设置项:', JSON.stringify(panelInfo))

console.log('== 深色 ==')
await evalJs(`localStorage.setItem('zenew_theme','dark')`)
await evalJs('location.reload()')
await sleep(4200)
await go('#/vocab/cet4/words', 'dark-wordlist', 3000)
await go('#/vocab/cet4/train/choice', 'dark-train-choice', 2600)
await go('#/vocab/cet4/train/dictation', 'dark-train-dictation', 2600)

console.log('\n未捕获异常:', errors.length ? errors : '无 ✓')
console.log('console.error:', consoleErr.length ? [...new Set(consoleErr)] : '无 ✓')
console.log('截图目录:', OUT)
process.exit(0)
