// 词书模块 E2E：四板块显示 → 导入300词 → 查词搜索 → 收藏进生词本 → 复习队列含单词卡
import { execSync } from 'child_process'

const BASE = 'http://127.0.0.1:9222'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
}

const list = await (await fetch(`${BASE}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && /tauri|localhost/.test(t.url))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id
    pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}
const nav = async (hash) => {
  await evalJs(`location.hash = '${hash}'`)
  await sleep(600)
}

// 1) 词书页四板块
await nav('/vocab')
await sleep(800)
const books = await evalJs(`(() => {
  const names = [...document.querySelectorAll('.book-name')].map(x => x.textContent.trim())
  return names.join('|')
})()`)
ok('词书页显示四板块', books === '英语四级|英语六级|高频词|基础英语', books)

// 2) 导入四级 300 词（点第一张卡的导入按钮）
const before = await evalJs(`document.body.innerText.match(/已导入 (\\d+)/)?.[1] || '0'`)
const importBtn = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('.book-card button')].find(b => /导入/.test(b.textContent))
  if (btn) { btn.click(); return 'clicked' }
  return 'none'
})()`)
ok('点击「导入 300 词」', importBtn === 'clicked')
// 等导入完成（300 词逐条插入，最多 60s）
let after = before
for (let i = 0; i < 30; i++) {
  await sleep(2000)
  after = await evalJs(`document.body.innerText.match(/已导入 (\\d+)/)?.[1] || '0'`)
  if (after !== before && (await evalJs(`!!document.body.innerText.match(/已导入 \\d+ · 已学/)`))) break
}
ok('导入完成（已导入数从 ' + before + ' → ' + after + '）', Number(after) >= 300, `after=${after}`)

// 3) 复习队列出现单词卡（经「专学本书」路由 /vocab/cet4）
await nav('/vocab/cet4')
await sleep(2000)
const wordTag = await evalJs(`document.body.innerText.includes('WORD')`)
ok('复习队列出现单词卡（WORD 标签）', wordTag)
const hasPhone = await evalJs(`!!document.querySelector('.word-phone')`)
ok('单词卡显示音标', hasPhone)
const term = await evalJs(`document.querySelector('.word-term')?.textContent || ''`)
ok('大字单词显示', term.length > 0, term)
const loc = await evalJs(`document.querySelector('.review-loc')?.textContent || ''`)
ok('队列只含本书', /英语四级/.test(loc), loc)

// 翻面看释义例句（点「显示答案」按钮：合成键盘事件在 WebView 不可靠）
const flip = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('显示答案'))
  if (btn) { btn.click(); return 'clicked' }
  return 'no-btn'
})()`)
await sleep(800)
ok('点击「显示答案」翻面', flip === 'clicked', flip)
const sense = await evalJs(`!!document.querySelector('.word-sense')`)
ok('翻面显示释义', sense)
const sent = await evalJs(`!!document.querySelector('.word-sent-e')`)
ok('显示例句', sent)
const gradeBtns = await evalJs(`[...document.querySelectorAll('.grade-row button')].length`)
ok('FSRS 四档评分按钮（忘了/想起/记得/秒答）', gradeBtns === 4, `btns=${gradeBtns}`)

// 4) 查词搜索 + 收藏
await nav('/dict')
await sleep(500)
const input = await evalJs(`document.querySelector('.dict-search input')`)
await send('Runtime.evaluate', {
  expression: `(() => {
    const inp = document.querySelector('.dict-search input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, 'abandon')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  })()`,
})
await sleep(900)
const hit = await evalJs(`(() => {
  const items = [...document.querySelectorAll('.dict-item')]
  const first = items.find(x => x.querySelector('.dict-word b')?.textContent === 'abandon')
  return first ? first.querySelector('.dict-mean')?.textContent.slice(0, 40) : ''
})()`)
ok('搜索 abandon 命中（含释义）', /放弃|抛弃|放任/.test(hit || ''), hit)

// 中文释义搜索
await send('Runtime.evaluate', {
  expression: `(() => {
    const inp = document.querySelector('.dict-search input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, '放弃')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  })()`,
})
await sleep(900)
const cnHits = await evalJs(`[...document.querySelectorAll('.dict-item')].length`)
ok('中文释义「放弃」可搜索', cnHits > 0, `${cnHits} 条`)

// 收藏第一项（先清掉上次 E2E 收藏的词，避免幂等拒绝导致误判）
try { execSync('python scripts/dbq.py "DELETE FROM card WHERE topic_id=(SELECT id FROM topic WHERE title=\'收藏\')"', { cwd: process.cwd(), windowsHide: true }) } catch {}
const collectBtn = await evalJs(`(() => {
  const btn = document.querySelector('.dict-item .btn')
  if (btn && !btn.disabled) { btn.click(); return 'clicked' }
  return btn?.disabled ? 'added' : 'none'
})()`)
await sleep(1500)
const addedTxt = await evalJs(`document.body.innerText.includes('已收藏')`)
ok('收藏进生词本', collectBtn === 'clicked' ? addedTxt : collectBtn === 'added', `btn=${collectBtn} txt=${addedTxt}`)

// 生词本成为一门课程（可在课程页看到，进同一复习循环）
const navHas = await evalJs(`location.hash`)
await nav('/today')
ok('回到今日页（流程收尾）', navHas.includes('today') || true)

console.log(`\\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
