// v0.10.1 验收：去购买按钮 / 自绘下拉 / 自绘日期选择器
const BASE = 'http://127.0.0.1:9222'
const list = await (await fetch(`${BASE}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && /tauri/.test(t.url))
if (!page) { console.log('未找到 Tauri 页面'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
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
  return r?.exceptionDetails ? 'EX: ' + r.exceptionDetails.text : r?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => results.push(`${ok ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`)
const gotoHash = async (h) => { await evalJs(`location.hash='${h}'`); await sleep(1500) }

// ---- 1. 去购买按钮（openUrl 权限） ----
await gotoHash('#/settings')
const buyClicked = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '去购买')
  if (!btn) return 'no-btn'
  btn.click()
  return 'clicked'
})()`)
await sleep(2500)
const buyErr = await evalJs(`document.body.innerText.includes('打开浏览器失败')`)
check('「去购买」不再报「打开浏览器失败」', buyClicked === 'clicked' && !buyErr, buyErr ? '仍失败' : 'ok')

// ---- 2. 自绘下拉（考试页课程选择） ----
await gotoHash('#/exams')
const selBtn = await evalJs(`document.querySelectorAll('.sel-btn').length`)
check('下拉控件已渲染（非系统 select）', selBtn >= 2, `控件 ${selBtn} 个`)
const sysSelect = await evalJs(`document.querySelectorAll('select').length`)
check('页面已无系统 select', sysSelect === 0, `残留 ${sysSelect}`)

const opened = await evalJs(`(() => {
  const btn = document.querySelectorAll('.sel-btn')[0]
  if (!btn) return 'no-btn'
  btn.click()
  return 'clicked'
})()`)
await sleep(600)
const popCount = await evalJs(`document.querySelectorAll('.sel-pop').length`)
const optCount = await evalJs(`document.querySelectorAll('.sel-pop .sel-opt').length`)
check('下拉弹层可展开', opened === 'clicked' && popCount === 1, `弹层 ${popCount} 选项 ${optCount}`)

const picked = await evalJs(`(() => {
  const opts = [...document.querySelectorAll('.sel-pop .sel-opt')]
  if (opts.length < 2) return 'need-two-options'
  const target = opts[1]
  const text = target.textContent.trim()
  target.click()
  return text
})()`)
await sleep(700)
const newLabel = await evalJs(`document.querySelectorAll('.sel-btn')[0].querySelector('.sel-label').textContent.trim()`)
const popClosed = await evalJs(`document.querySelectorAll('.sel-pop').length`)
check('选择后标签更新且弹层关闭', picked !== 'need-two-options' && newLabel === picked && popClosed === 0, `选中「${picked}」→ 显示「${newLabel}」`)

// ---- 3. 自绘日期选择器 ----
const dpOpened = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('.sel-btn')]
  const btn = btns.find(b => b.textContent.includes('选择日期') || /\d{4}-\d{2}-\d{2}/.test(b.textContent))
  if (!btn) return 'no-btn'
  btn.click()
  return 'clicked'
})()`)
await sleep(600)
const dpPop = await evalJs(`document.querySelectorAll('.dp-pop').length`)
const dpCells = await evalJs(`document.querySelectorAll('.dp-pop .dp-cell:not(.is-empty)').length`)
const dpDisabled = await evalJs(`document.querySelectorAll('.dp-pop .dp-cell[disabled]').length`)
check('日期弹层可展开', dpOpened === 'clicked' && dpPop === 1, `弹层 ${dpPop} 可选日 ${dpCells} 禁用(过去) ${dpDisabled}`)
check('过去日期被禁用', dpDisabled > 0, `禁用 ${dpDisabled} 天`)

const dpPicked = await evalJs(`(() => {
  const cells = [...document.querySelectorAll('.dp-pop .dp-cell:not(.is-empty):not([disabled])')]
  if (!cells.length) return 'no-available'
  const c = cells[cells.length - 1]
  const day = c.textContent.trim()
  c.click()
  return day
})()`)
await sleep(700)
const dpLabel = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('.sel-btn')]
  const btn = btns.find(b => /\\d{4}-\\d{2}-\\d{2}/.test(b.textContent))
  return btn ? btn.querySelector('.sel-label').textContent.trim() : ''
})()`)
check('选择日期后回填', /^\d{4}-\d{2}-\d{2}$/.test(dpLabel) && dpLabel.endsWith(String(dpPicked).padStart(2, '0')), `点「${dpPicked}」→ ${dpLabel}`)

// ---- 4. 用新控件真的能建考试 ----
const addRes = await evalJs(`(() => {
  const input = document.querySelector('input[placeholder*="考试名称"]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '__控件E2E__')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '添加')
  btn.click()
  return 'clicked'
})()`)
await sleep(1600)
const examAdded = await evalJs(`document.body.innerText.includes('__控件E2E__')`)
check('用自绘控件可成功添加考试', addRes === 'clicked' && examAdded)

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('✗')).length
console.log(`\n结果：${results.length - fails} 通过 / ${fails} 失败`)
process.exit(fails ? 1 : 0)
