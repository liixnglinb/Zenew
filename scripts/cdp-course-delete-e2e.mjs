// 课程删除级联 E2E：造一门测试课（含知识点/卡片/状态/日志）→ 驱动 UI 删除 → 断言全清
import { execSync } from 'child_process'

const DB = process.env.APPDATA + '/com.zenew.app/zenew.db'
const BASE = 'http://127.0.0.1:9222'

// 用 scripts/dbq.py 执行（本机无 sqlite3 CLI）
function sql(q) {
  const script = new URL('./dbq.py', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  const out = execSync(`python "${decodeURIComponent(script)}" ${JSON.stringify(q)}`, { encoding: 'utf8' })
  return out.trim()
}

// 1. 造测试课程
sql(`INSERT INTO course(name,kind,created_at) VALUES('__删除测试课__','seed','2026-09-20T00:00:00Z')`)
const cid = sql(`SELECT id FROM course WHERE name='__删除测试课__'`)
sql(`INSERT INTO topic(course_id,parent_id,title,sort) VALUES(${cid},NULL,'测试章',0)`)
const chId = sql(`SELECT id FROM topic WHERE course_id=${cid} AND parent_id IS NULL`)
sql(`INSERT INTO topic(course_id,parent_id,title,sort) VALUES(${cid},${chId},'测试知识点',0)`)
const tpId = sql(`SELECT id FROM topic WHERE parent_id=${chId}`)
sql(`INSERT INTO card(topic_id,type,front,back,explanation,created_at) VALUES(${tpId},'basic','测试题面','答案','解释','2026-09-20T00:00:00Z')`)
const cardId = sql(`SELECT id FROM card WHERE topic_id=${tpId}`)
sql(`INSERT INTO card_state(card_id,due,state,reps) VALUES(${cardId},'2026-09-20T00:00:00Z',2,1)`)
sql(`INSERT INTO review_log(card_id,rating,reviewed_at,duration_ms) VALUES(${cardId},3,'2026-09-20T00:00:00Z',1000)`)
console.log(`测试课程已创建 id=${cid} 章=${chId} 知识点=${tpId} 卡=${cardId}`)

// 2. 驱动 UI 删除
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = await (await fetch(`${BASE}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && /tauri/.test(t.url))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res) => (ws.onopen = res))
let id = 0
const send = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    const mid = ++id
    const on = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id === mid) { ws.removeEventListener('message', on); resolve(m.result) }
    }
    ws.addEventListener('message', on)
    ws.send(JSON.stringify({ id: mid, method, params, sessionId }))
  })
const { sessionId } = await send('Target.attachToTarget', { targetId: page.id, flatten: true })
await send('Runtime.enable', {}, sessionId)
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)
  return r?.result?.value
}

await evalJs(`location.hash = '#/today'`)
await sleep(600)
await evalJs(`location.hash = '#/courses'`)
await sleep(2500)

const clicked = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('.row')]
  const row = rows.find(r => r.innerText.includes('__删除测试课__'))
  if (!row) return 'row-not-found'
  const del = row.querySelector('.row-del')
  if (!del) return 'del-not-found'
  del.click()
  return 'clicked'
})()`)
console.log('删除按钮点击:', clicked)
await sleep(700)
const confirmed = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('.row')]
  const row = rows.find(r => r.innerText.includes('__删除测试课__'))
  if (!row) return 'row-gone'
  const btn = [...row.querySelectorAll('button')].find(b => b.innerText.includes('确认删除'))
  if (!btn) return 'confirm-not-found'
  btn.click()
  return 'confirmed'
})()`)
console.log('确认删除:', confirmed)
await sleep(2500)

const uiGone = await evalJs(`![...document.querySelectorAll('.row')].some(r => r.innerText.includes('__删除测试课__'))`)
console.log('UI 中已消失:', uiGone ? '是' : '否')

// 3. 断言全库清空
const left = {
  course: sql(`SELECT COUNT(*) FROM course WHERE id=${cid}`),
  topic: sql(`SELECT COUNT(*) FROM topic WHERE course_id=${cid}`),
  card: sql(`SELECT COUNT(*) FROM card WHERE id=${cardId}`),
  state: sql(`SELECT COUNT(*) FROM card_state WHERE card_id=${cardId}`),
  log: sql(`SELECT COUNT(*) FROM review_log WHERE card_id=${cardId}`),
}
const allZero = Object.values(left).every((v) => v === '0')
console.log('残留统计:', JSON.stringify(left))
console.log(allZero && uiGone ? '✓ 课程删除级联清理完整' : '✗ 有残留数据')
process.exit(allZero && uiGone ? 0 : 1)
