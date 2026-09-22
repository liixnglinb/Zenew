// v0.14.0 学习界面 E2E：无自动全屏 / 全屏按钮切态 / 侧栏沉浸隐藏 / 3D 翻面 / 单词卡排版
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const chk = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`) }

await sleep(9000)
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && /tauri|localhost/.test(t.url))
if (!page) { console.log('✗ 找不到应用页面'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value

// 1) 进入词书复习
await evalJs(`location.hash = '#/vocab/cet4'`)
await sleep(1800)
const entered = await evalJs(`!!document.querySelector('.review-card') || [...document.querySelectorAll('button')].some(x => /开始学习|继续学习/.test(x.textContent))`)
if (!entered) { console.log('✗ 未能进入复习'); process.exit(1) }
await sleep(500)

// 2) 不自动全屏：窗口应为非全屏
const notFs = await evalJs(`!document.querySelector('.review-stage')?.classList.contains('review-fs')`)
chk('默认不自动进全屏', notFs)

// 3) 侧栏隐藏（沉浸态：/vocab/:key 下无 .sidebar）
const noSidebar = await evalJs(`!document.querySelector('.sidebar')`)
chk('复习时侧栏隐藏（沉浸）', noSidebar)

// 4) 正面结构：大字单词 + 音标 +「显示答案」居中
const hasWordFront = await evalJs(`!!document.querySelector('.word-term') && !!document.querySelector('.reveal-row .btn-primary')`)
chk('单词正面结构（大字+显示答案）', hasWordFront)
const centered = await evalJs(`(() => { const r = document.querySelector('.reveal-row'); if (!r) return false; const b = r.querySelector('button'); const rb = r.getBoundingClientRect(); const bb = b.getBoundingClientRect(); return Math.abs((bb.left + bb.width / 2) - (rb.left + rb.width / 2)) < 4 })()`)
chk('「显示答案」水平居中', centered)

// 5) 翻面：点「显示答案」→ .is-flipped + 背面词条出现
await evalJs(`[...document.querySelectorAll('button')].find(x => x.textContent.includes('显示答案'))?.click()`)
await sleep(700)
const flipped = await evalJs(`!!document.querySelector('.flip-wrap.is-flipped')`)
chk('翻面动画类生效（is-flipped）', flipped)
const backShown = await evalJs(`!!document.querySelector('.flip-back .word-back-term') && !!document.querySelector('.flip-back .word-senses')`)
chk('背面词条结构（词头+释义）', backShown)
const gradeVisible = await evalJs(`(() => { const b = [...document.querySelectorAll('.grade-row .btn')]; return b.length === 4 && b.every(x => x.offsetParent) })()`)
chk('背面四档评分按钮可见', gradeVisible)

// 6) 全屏切换按钮存在并可用
const fsBtn = await evalJs(`(() => { const b = document.querySelector('.review-top .review-exit'); return !!b && b.title.includes('全屏') })()`)
chk('全屏切换按钮在顶部栏', fsBtn)
await evalJs(`[...document.querySelectorAll('.review-top .review-exit')].find(b => b.title.includes('全屏'))?.click()`)
await sleep(1200)
const nowFs = await evalJs(`!!document.querySelector('.review-stage.review-fs')`)
chk('点按钮进入全屏（review-fs 生效）', nowFs)
await evalJs(`[...document.querySelectorAll('.review-top .review-exit')].find(b => b.title.includes('全屏'))?.click()`)
await sleep(1200)
const nowNotFs = await evalJs(`!document.querySelector('.review-stage.review-fs')`)
chk('再点退出全屏', nowNotFs)

console.log(`\\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
