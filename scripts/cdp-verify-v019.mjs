// v0.19.0 美术风格验收：侧栏圆角/材质、按钮、首页 bento、书封、文案精简、浅深色
import { writeFileSync, mkdirSync } from 'fs'
const OUT = 'C:/Users/李星历/Desktop/课程学习软件/视频解析/v019-shots'
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
const go = async (hash, wait = 2600) => { await evalJs(`location.hash='${hash}'`); await sleep(wait) }

await send('Runtime.enable'); await send('Page.enable')
const MOCK = `localStorage.setItem('zenew_token','v019');
const _f=window.fetch.bind(window);
window.fetch=(i,n)=>{const u=typeof i==='string'?i:(i&&i.url)||'';
 if(u.endsWith('/me'))return Promise.resolve(new Response(JSON.stringify({email:'v@local'}),{status:200,headers:{'Content-Type':'application/json'}}));
 if(u.includes('/billing/')||u.includes('/gen/'))return Promise.resolve(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}));
 return _f(i,n);};`
await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK })

async function theme(t) {
  // 主题模式存在 zenew_settings.mode，只改 zenew_theme 不够
  await evalJs(`localStorage.setItem('zenew_theme','${t}')`)
  await evalJs(`localStorage.setItem('zenew_settings', JSON.stringify(Object.assign({}, JSON.parse(localStorage.getItem('zenew_settings')||'{}'), { mode:'${t}' })))`)
  await evalJs('location.reload()')
  await sleep(4600)
}

// ---------- 结构与材质量测（浅色） ----------
await theme('light')
const metrics = await evalJs(`(() => {
  const q = (s) => document.querySelector(s)
  const cs = (s) => { const e=q(s); return e ? getComputedStyle(e) : null }
  const nav = cs('.sidenav'), card = cs('.card, .plan-card'), btn = cs('.btn-primary'), body = cs('body')
  return {
    主题: document.documentElement.dataset.theme,
    侧栏: nav && { 圆角: nav.borderRadius, 边距: nav.margin, 背景: nav.backgroundColor, 阴影: nav.boxShadow.slice(0,60) },
    卡片: card && { 圆角: card.borderRadius, 背景: card.backgroundImage.slice(0,50), 描边: card.boxShadow.slice(0,50) },
    主按钮: btn && { 圆角: btn.borderRadius, 背景: btn.backgroundImage === 'none' ? btn.backgroundColor : btn.backgroundImage.slice(0,40), 高度: btn.height },
    首页是否有词云: !!q('.wordcloud'),
    首页新模块: { hm指标: document.querySelectorAll('[class*="hm-"]').length },
    卡片颗粒: card && card.backgroundImage.includes('radial-gradient') ? '有' : '未见'
  } })()`)
console.log('浅色量测:', JSON.stringify(metrics, null, 1))
await go('#/today', 2600); await shot('light-home')
await go('#/vocab', 2600); await shot('light-vocab')
await go('#/vocab/cet4/words', 3000); await shot('light-wordlist')
await go('#/vocab/cet4/train/choice', 2600); await shot('light-train-choice')

// ---------- 深色 ----------
await theme('dark')
const dark = await evalJs(`(() => { const nav=getComputedStyle(document.querySelector('.sidenav')); const c=document.querySelector('.card,.plan-card'); return { 主题:document.documentElement.dataset.theme, 侧栏圆角:nav.borderRadius, 侧栏底:nav.backgroundColor, 卡片底:c?getComputedStyle(c).backgroundColor:null } })()`)
console.log('深色量测:', JSON.stringify(dark))
await go('#/today', 2600); await shot('dark-home')
await go('#/vocab', 2600); await shot('dark-vocab')
await go('#/vocab/cet4/words', 3000); await shot('dark-wordlist')

// ---------- 文案精简抽查 ----------
const copy = await evalJs(`(() => { const t=document.body.innerText; return {
  残留_单词或释义: t.includes('搜索单词或释义'),
  残留_按词库默认: t.includes('按词书默认顺序'),
  残留_操作提示: t.includes('完全没印象时选') || t.includes('点选项作答'),
  残留_说明句: t.includes('判定结果同样计入') || t.includes('导入即进入科学复习循环'),
  残留_ORBIT: t.includes('WORDS IN ORBIT') } })()`)
console.log('文案残留检查:', JSON.stringify(copy))

console.log('\n未捕获异常:', errors.length ? errors : '无 ✓')
console.log('console.error:', consoleErr.length ? [...new Set(consoleErr)] : '无 ✓')
console.log('截图目录:', OUT)
process.exit(0)
