// v0.10.0 新功能真机 E2E：考试日历 / 卡片暂停恢复 / 导入断点续传
import { execSync } from 'child_process'

const BASE = 'http://127.0.0.1:9222'
const SCRIPT_DIR = decodeURIComponent(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

const sql = (q) => execSync(`python "${SCRIPT_DIR}dbq.py" ${JSON.stringify(q)}`, { encoding: 'utf8' }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)

// ---- CDP ----
const list = await (await fetch(`${BASE}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && /tauri/.test(t.url))
if (!page) { console.log('未找到 Tauri 页面'); process.exit(1) }
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
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r?.result?.value
}
const gotoHash = async (h) => { await evalJs(`location.hash='${h}'`); await sleep(1500) }

// React 受控输入必须走原生 setter + input 事件
const setField = (selector, value, tag = 'input') => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return 'no-el'
  const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : (el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype)
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(el, ${JSON.stringify(String(value))})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return 'ok'
})()`

// ================= A. 考试日历 =================
await gotoHash('#/exams')
const hasExamPage = await evalJs(`document.querySelector('.page-title')?.textContent`)
check('考试页可访问', hasExamPage === '考试', String(hasExamPage))

const examDate = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
const selRes = await evalJs(`(() => {
  const sel = document.querySelector('select.input')
  if (!sel || !sel.options.length) return 'no-select'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  setter.call(sel, sel.options[0].value)
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  return sel.options[0].textContent
})()`)
check('考试页课程下拉可用', selRes !== 'no-select', String(selRes))

await evalJs(setField('input[placeholder*="考试名称"]', '__E2E考试__'))
await evalJs(setField('input[type="date"]', examDate))
await sleep(400)
const added = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '添加')
  if (!btn) return 'no-btn'
  btn.click()
  return 'clicked'
})()`)
await sleep(1500)
const examInDom = await evalJs(`document.body.innerText.includes('__E2E考试__') && document.body.innerText.includes('10 天后')`)
check('考试添加并显示倒计时', examInDom, `${added} / 日期 ${examDate}`)

await gotoHash('#/today')
const todayExam = await evalJs(`(() => {
  const pills = [...document.querySelectorAll('.streak-pill')]
  const p = pills.find(x => x.textContent.includes('__E2E考试__'))
  return p ? p.textContent.trim() : ''
})()`)
check('今日页显示最近考试倒计时', todayExam.length > 0, todayExam)

// ================= B. 卡片暂停/恢复 =================
await gotoHash('#/courses')
const courseClicked = await evalJs(`(() => {
  const btn = document.querySelector('.row-open')
  if (!btn) return 'no-course'
  btn.click()
  return 'clicked'
})()`)
await sleep(1800)
check('进入课程详情', courseClicked === 'clicked', courseClicked)

const topicOpened = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('.row-open')]
  if (!btns.length) return 'no-topic'
  btns[0].click()
  return 'clicked'
})()`)
await sleep(1400)
const cardCount = await evalJs(`document.querySelectorAll('.card-item').length`)
check('知识点展开显示卡片', topicOpened === 'clicked' && cardCount > 0, `卡片 ${cardCount} 张`)

const suspendRes = await evalJs(`(() => {
  const items = [...document.querySelectorAll('.card-item')]
  const item = items.find(i => !i.classList.contains('is-suspended'))
  if (!item) return 'no-unsuspended'
  const btn = [...item.querySelectorAll('button')].find(b => b.textContent.trim() === '暂停')
  if (!btn) return 'no-btn'
  item.dataset.front = item.querySelector('.card-item-front').textContent
  btn.click()
  return 'clicked'
})()`)
await sleep(1200)
const suspendedDb = sql('SELECT COUNT(*) FROM card WHERE suspended=1')
const nowSuspendedClass = await evalJs(`document.querySelectorAll('.card-item.is-suspended').length`)
check('卡片暂停写入数据库', Number(suspendedDb) >= 1, `suspended=${suspendedDb}`)
check('暂停态在 UI 呈现', nowSuspendedClass >= 1, `条数 ${nowSuspendedClass}`)

// 队列应排除暂停卡（与 loadQueue 同条件）
const queueExcluded = sql(`SELECT COUNT(*) FROM card c LEFT JOIN card_state cs ON cs.card_id=c.id WHERE c.suspended=1`)
check('暂停卡被排除在队列条件外', Number(queueExcluded) >= 1, `匹配 ${queueExcluded}`)

const restoreRes = await evalJs(`(() => {
  const item = [...document.querySelectorAll('.card-item.is-suspended')][0]
  if (!item) return 'no-suspended'
  const btn = [...item.querySelectorAll('button')].find(b => b.textContent.trim() === '恢复')
  if (!btn) return 'no-btn'
  btn.click()
  return 'clicked'
})()`)
await sleep(1200)
const afterRestore = sql('SELECT COUNT(*) FROM card WHERE suspended=1')
check('恢复后回到学习队列', restoreRes === 'clicked' && Number(afterRestore) === 0, `suspended=${afterRestore}`)

// ================= C. 导入断点续传 =================
sql(`INSERT INTO course(name,kind,created_at,import_status,import_name,import_total) VALUES('__续传测试课__','pdf','2026-09-20T00:00:00Z','processing','续传样本.pdf',2)`)
const cid = sql("SELECT id FROM course WHERE name='__续传测试课__'")
const seg1 = '第一章 数据结构基础。数据结构是计算机存储、组织数据的方式。常见结构包括数组、链表、栈和队列。数组支持随机访问，链表插入删除效率高。栈是后进先出的线性表，队列是先进先出的线性表。'
const seg2 = '第二章 排序算法。冒泡排序通过相邻元素比较交换实现，时间复杂度为平方级。快速排序采用分治思想，平均时间复杂度为线性对数级。归并排序稳定且时间复杂度同为线性对数级。'
sql(`INSERT INTO import_segment(course_id,seg_index,chapter,text,status) VALUES(${cid},0,'第一章 数据结构基础','${seg1}','pending')`)
sql(`INSERT INTO import_segment(course_id,seg_index,chapter,text,status) VALUES(${cid},1,'第二章 排序算法','${seg2}','pending')`)

await gotoHash('#/courses')
await sleep(1200)
const bannerText = await evalJs(`document.body.innerText`)
check('未完成导入横幅出现', bannerText.includes('导入未完成') && bannerText.includes('__续传测试课__'))

const resumeClicked = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '继续导入')
  if (!btn) return 'no-btn'
  btn.click()
  return 'clicked'
})()`)
check('点击「继续导入」', resumeClicked === 'clicked', resumeClicked)

// 等待流水线跑完（2 段 × LLM）
let status = ''
for (let i = 0; i < 40; i++) {
  await sleep(3000)
  status = sql(`SELECT import_status FROM course WHERE id=${cid}`)
  const pendingLeft = sql(`SELECT COUNT(*) FROM import_segment WHERE course_id=${cid} AND status='pending'`)
  if (status === 'done' || Number(pendingLeft) === 0) break
}
const topics = sql(`SELECT COUNT(*) FROM topic WHERE course_id=${cid} AND parent_id IS NOT NULL`)
check('续传处理完成（状态 done）', status === 'done', `status=${status}`)
check('知识点已落库', Number(topics) > 0, `知识点 ${topics}`)

// 清理测试数据
sql(`DELETE FROM card_state WHERE card_id IN (SELECT id FROM card WHERE topic_id IN (SELECT id FROM topic WHERE course_id=${cid}))`)
sql(`DELETE FROM card WHERE topic_id IN (SELECT id FROM topic WHERE course_id=${cid})`)
sql(`DELETE FROM topic WHERE course_id=${cid}`)
sql(`DELETE FROM import_segment WHERE course_id=${cid}`)
sql(`DELETE FROM source_doc WHERE course_id=${cid}`)
sql(`DELETE FROM course WHERE id=${cid}`)
sql("DELETE FROM exam WHERE title='__E2E考试__'")
console.log('（测试数据已清理）')

console.log('\n' + results.join('\n'))
const fails = results.filter((r) => r.startsWith('✗')).length
console.log(`\n结果：${results.length - fails} 通过 / ${fails} 失败`)
process.exit(fails ? 1 : 0)
