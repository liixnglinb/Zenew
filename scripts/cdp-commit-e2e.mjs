// 评分提交 E2E（v0.13.2 修复验证）：词书专学 → 翻面 → 评分 → 断言无「保存失败」+ card_state/review_log 落库
import { execSync } from 'child_process'
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

// 动态取「当前会话正在评的卡」（快照 idx 指向）作为基线，不硬编码卡号
const sessRaw = execSync("python scripts/dbq2.py \"SELECT IFNULL(value,'{}') AS v FROM _zenew_meta WHERE key='session_queue'\"").toString().trim()
const sessObj = JSON.parse(JSON.parse(sessRaw).v)
const firstCard = sessObj.card_ids[sessObj.idx] || 0
console.log(`  （基线卡 ${firstCard}）`)
const baseline = (JSON.parse(execSync(`python scripts/dbq2.py "SELECT IFNULL(reps,0) AS reps FROM card_state WHERE card_id=${firstCard}"`).toString().trim() || '{}').reps) ?? 0

// 进入词书专学（英语四级第一组）
await evalJs(`location.hash = '#/vocab/cet4'`)
await sleep(1500)
const btn = await evalJs(`(() => { const els = [...document.querySelectorAll('button')]; if (els.some(x => /开始学习|继续学习|复习/.test(x.textContent))) { els.find(x => /开始学习|继续学习|复习/.test(x.textContent)).click(); return 'clicked' } if (els.some(x => x.textContent.includes('显示答案'))) return 'resumed'; return '' })()`)
chk('进入英语四级专学（点击或自动续学）', !!btn, btn)
await sleep(2000)

// 翻面（点「显示答案」按钮——合成键盘事件不可信）
const flipped = await evalJs(`(() => { const els = [...document.querySelectorAll('button')]; const b = els.find(x => x.textContent.includes('显示答案')); if (b) { b.click(); return true } return false })()`)
chk('翻面显示答案', !!flipped)
await sleep(600)

// 点「秒答 4」评分
const graded = await evalJs(`(() => { const els = [...document.querySelectorAll('button')]; const b = els.find(x => /秒答/.test(x.textContent)); if (b) { b.click(); return true } return false })()`)
chk('评分「秒答」', !!graded)
await sleep(1500)

// 断言 1：界面无「保存失败」
const errGone = await evalJs(`!document.body.innerText.includes('保存失败')`)
chk('界面无「保存失败」', errGone)

// 断言 2：界面已推进（不再停在评分按钮态）
const advanced = await evalJs(`!!document.querySelector('.review-card') && !([...document.querySelectorAll('button')].some(x => /秒答/.test(x.textContent) && x.offsetParent))`)
chk('评分后已推进到下一张', advanced)

// 断言 3：review_log 落库（当前会话第一张卡有新记录）
const log = execSync(`python scripts/dbq2.py "SELECT COUNT(*) AS n FROM review_log WHERE card_id=${firstCard}"`).toString().trim()
chk('review_log 已落库（≥1 条）', Number(JSON.parse(log || '{"n":0}').n) >= 1, log)

// 断言 4：card_state 更新（reps 增长）
const after = (JSON.parse(execSync(`python scripts/dbq2.py "SELECT IFNULL(reps,0) AS reps FROM card_state WHERE card_id=${firstCard}"`).toString().trim() || '{}').reps) ?? 0
chk('card_state.reps 增长', after > baseline, `${baseline} → ${after}`)

console.log(`\\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
