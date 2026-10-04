// v0.21.0 验收：首页驾驶舱两栏、统计图表化与 7/14/30 切换、形义徽标、排行榜主题化、可解释面板
import { writeFileSync, mkdirSync } from 'fs'
const OUT = '../视频解析/v021-shots'
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
  return r.result?.exceptionDetails ? `ERR ${r.result.exceptionDetails.text}` : r.result?.result?.value
}
const shot = async (n) => { const m = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${n}.png`, Buffer.from(m.result.data, 'base64')); console.log('  截图', n) }
const go = async (hash, wait = 2800) => { await evalJs(`location.hash='${hash}'`); await sleep(wait) }

await send('Runtime.enable'); await send('Page.enable')
const MOCK = `localStorage.setItem('zenew_token','v021');
const _f=window.fetch.bind(window);
window.fetch=(i,n)=>{const u=typeof i==='string'?i:(i&&i.url)||'';
 if(u.endsWith('/me'))return Promise.resolve(new Response(JSON.stringify({email:'v@local'}),{status:200,headers:{'Content-Type':'application/json'}}));
 if(u.includes('/billing/')||u.includes('/gen/'))return Promise.resolve(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}));
 return _f(i,n);};`
await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK })

async function theme(t) {
  await evalJs(`localStorage.setItem('zenew_theme','${t}')`)
  await evalJs(`localStorage.setItem('zenew_settings', JSON.stringify(Object.assign({}, JSON.parse(localStorage.getItem('zenew_settings')||'{}'), { mode:'${t}' })))`)
  await evalJs('location.reload()'); await sleep(4600)
}

// ---------- 浅色 ----------
await theme('light')
console.log('== 首页驾驶舱 ==')
await go('#/today', 3200)
const home = await evalJs(`(() => { const t=document.body.innerText; return {
  两栏: getComputedStyle(document.querySelector('.grid-2.is-aside') || document.body).gridTemplateColumns.split(' ').length,
  五档条: !!document.querySelector('[class*="tier"]') || t.includes('初记'),
  生词本入口: t.includes('生词本'),
  驾驶舱类: !!document.querySelector('[class*="hm-cockpit"], [class*="cockpit"]') } })()`)
console.log('  驾驶舱:', JSON.stringify(home))
await shot('light-home')

console.log('== 统计图表 ==')
await go('#/stats', 3000)
const svg = await evalJs(`(() => { return { 折线: document.querySelectorAll('polyline').length, 面积path: document.querySelectorAll('path').length, 切换控件: [...document.querySelectorAll('button')].filter(b=>/^(7|14|30)\\s*天$/.test(b.textContent.trim())).length, 基准线: !!document.querySelector('[class*="today"], [class*="baseline"]') } })()`)
console.log('  图表元素:', JSON.stringify(svg))
await shot('light-stats-7')
const switched = await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^30\\s*天$/.test(x.textContent.trim())); if(!b) return 'no-30d'; b.click(); return 'clicked' })()`)
await sleep(1600)
const svg30 = await evalJs(`({ 点数: document.querySelectorAll('.area-col, polyline circle').length, 文本含30: document.body.innerText.includes('30') })`)
console.log('  切到30天:', switched, JSON.stringify(svg30))
await shot('light-stats-30')

console.log('== 形义徽标与排行榜 ==')
await go('#/vocab/cet4/train/choice', 3000)
const emblem = await evalJs(`(() => { const m=document.querySelector('.media-card'); return m ? { 徽标: !!m, 背景: getComputedStyle(m).backgroundImage.slice(0,60) } : { 徽标: false } })()`)
console.log('  媒体卡徽标:', JSON.stringify(emblem))
await shot('light-train-choice-emblem')
await go('#/rank', 3000)
const rank = await evalJs(`(() => { return { 整页深色已移除: !document.querySelector('.dark-page'), 主题卡: getComputedStyle(document.querySelector('.rank-row') || document.body).backgroundColor, 领奖台: document.querySelectorAll('[class*="podium"]').length } })()`)
console.log('  排行榜:', JSON.stringify(rank))
await shot('light-rank')

console.log('== 可解释面板 ==')
await go('#/vocab/cet4/train/choice', 2800)
await evalJs(`(() => { const c=[...document.querySelectorAll('.choice-cell')]; if(c.length) c[0].click(); })()`)
await sleep(2200)
const why = await evalJs(`(() => { const t=document.body.innerText; return { 为什么现在复习: t.includes('为什么现在复习'), 记忆强度: t.includes('记忆强度'), 遗忘: t.includes('遗忘') } })()`)
console.log('  可解释面板:', JSON.stringify(why))
await shot('light-explainable')

// ---------- 深色 ----------
await theme('dark')
await go('#/today', 3000); await shot('dark-home')
await go('#/stats', 3000); await shot('dark-stats')
await go('#/rank', 3000); await shot('dark-rank')

console.log('\n未捕获异常:', errors.length ? errors : '无 ✓')
console.log('console.error:', consoleErr.length ? [...new Set(consoleErr)] : '无 ✓')
console.log('截图目录:', OUT)
process.exit(0)
