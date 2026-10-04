// v0.18.0 交互验收：①选义作答（评分落库）②听写设置面板 ③深色词表
import { writeFileSync, mkdirSync } from 'fs'
const OUT = '../视频解析/v018-shots'
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
  if (m.method === 'Runtime.exceptionThrown') errors.push(`${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description || ''}`.slice(0, 200))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErr.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160))
}
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
const evalJs = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return `ERR ${r.result.exceptionDetails.text}`
  return r.result?.result?.value
}
const shot = async (n) => { const m = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${n}.png`, Buffer.from(m.result.data, 'base64')) }
const go = async (hash, wait = 2600) => { await evalJs(`location.hash='${hash}'`); await sleep(wait) }

await send('Runtime.enable'); await send('Page.enable')
const MOCK = `
localStorage.setItem('zenew_token','v018b');
const _f = window.fetch.bind(window);
window.fetch = (input, init) => { const u = typeof input === 'string' ? input : (input && input.url) || '';
  if (u.endsWith('/me')) return Promise.resolve(new Response(JSON.stringify({email:'verify@local'}),{status:200,headers:{'Content-Type':'application/json'}}));
  if (u.includes('/billing/')||u.includes('/gen/')) return Promise.resolve(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}));
  return _f(input, init); };`
await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK })
await evalJs(`localStorage.setItem('zenew_theme','light')`)
await evalJs('location.reload()')
await sleep(4200)

// ---------- ① 选义作答 ----------
await go('#/vocab/cet4/train/choice', 3200)
const before = await evalJs(`({ count: document.querySelector('.train-count')?.textContent?.trim(), opts: document.querySelectorAll('.choice-cell').length, first: document.querySelector('.train-body')?.innerText?.split('\\n').filter(Boolean).slice(0,3).join(' | ') })`)
console.log('选义页:', JSON.stringify(before))
const clickInfo = await evalJs(`(() => { const c=document.querySelector('.choice-cell'); if(!c) return 'no-option'; c.click(); return c.innerText.replace(/\\s+/g,' ').slice(0,40); })()`)
console.log('点击选项:', clickInfo)
await sleep(2600)
const after = await evalJs(`({ count: document.querySelector('.train-count')?.textContent?.trim(), first: document.querySelector('.train-body')?.innerText?.split('\\n').filter(Boolean).slice(0,3).join(' | ') })`)
console.log('作答后:', JSON.stringify(after))
await shot('light-choice-answered')

// ---------- ② 听写设置面板 ----------
await go('#/vocab/cet4/train/dictation', 2600)
const opened = await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(e=>/听写设置/.test(e.textContent)); if(!b) return 'no-btn'; b.click(); return 'clicked'; })()`)
await sleep(1400)
await shot('light-dictation-sheet')
const sheet = await evalJs(`(() => { const t=document.body.innerText; const sheetEl=document.querySelector('.train-sheet-title'); return { 打开: !!sheetEl, 模式卡: document.querySelectorAll('.train-opt.is-lg').length, 美音: t.includes('美音'), 英音: t.includes('英音'), 播放次数: t.includes('播放次数'), 播放间隔: t.includes('播放间隔'), 自动播放下一词: t.includes('自动播放下一词'), 次数选项: ['1次','2次','3次'].filter(x=>t.includes(x)), 间隔选项: ['2秒','4秒','6秒','8秒'].filter(x=>t.includes(x)) } })()`)
console.log('听写设置:', opened, JSON.stringify(sheet))
await evalJs(`document.querySelector('.modal-mask, .sheet-mask')?.click()`)
await sleep(600)

// ---------- ③ 深色词表 ----------
await evalJs(`localStorage.setItem('zenew_theme','dark')`); await evalJs('location.reload()'); await sleep(4200)
await go('#/vocab/cet4/words', 3200)
await shot('dark-wordlist-2')
const dark = await evalJs(`(() => { const t=document.body.innerText; return { 六页签: ['全部','今日','未学习','学习中','已熟识','已斩'].filter(x=>t.includes(x)).length, 共N词: /共\\s*\\d+\\s*词/.test(t), 训练坞: document.querySelectorAll('.wl-dock-item').length, 行数: document.querySelectorAll('[class*="wl-row"]').length } })()`)
console.log('深色词表:', JSON.stringify(dark))

console.log('\n未捕获异常:', errors.length ? errors : '无 ✓')
console.log('console.error:', consoleErr.length ? [...new Set(consoleErr)] : '无 ✓')
process.exit(0)
