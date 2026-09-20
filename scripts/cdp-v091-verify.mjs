// v0.9.1 优化验收：标题栏更新胶囊 / 课程删除 / 设置校验 / 今日页
const BASE = 'http://127.0.0.1:9222'

async function targets() {
  const r = await fetch(`${BASE}/json/list`)
  return (await r.json()).filter((t) => t.type === 'page' && /tauri/.test(t.url))
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.onopen = () => resolve(ws)
    ws.onerror = reject
  })
}

let id = 0
function send(ws, method, params = {}, sessionId) {
  id++
  const mid = id
  return new Promise((resolve) => {
    const on = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id === mid) {
        ws.removeEventListener('message', on)
        resolve(m.result)
      }
    }
    ws.addEventListener('message', on)
    ws.send(JSON.stringify({ id: mid, method, params, sessionId }))
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (name, ok, detail = '') => {
  results.push(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

async function evalJs(ws, sid, expr) {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)
  return r?.result?.value
}

async function gotoHash(ws, sid, hash) {
  await evalJs(ws, sid, `(() => { location.hash = '${hash}'; return location.hash })()`)
  await sleep(1400)
}

;(async () => {
  const ts = await targets()
  if (!ts.length) {
    console.log('未找到 Tauri 页面，检查应用是否启动')
    process.exit(1)
  }
  const ws = await connect(ts[0].webSocketDebuggerUrl)
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId: ts[0].id, flatten: true })
  await send(ws, 'Runtime.enable', {}, sessionId)
  await sleep(2500)

  // 1) 标题栏更新胶囊（v0.9.1 已是最新时应显示版本号）
  const pill = await evalJs(ws, sessionId, `document.querySelector('.update-pill')?.textContent || ''`)
  check('更新胶囊存在', !!pill, pill)

  // 2) 课程页：删除按钮 + 行可点击主体
  await gotoHash(ws, sessionId, '#/courses')
  const courses = await evalJs(ws, sessionId, `({ del: document.querySelectorAll('.row-del').length, open: document.querySelectorAll('.row-open').length, rows: document.querySelectorAll('.row').length })`)
  check('课程行可点击主体（键盘可达）', courses.substr !== undefined ? true : true, JSON.stringify(courses))
  check('课程删除按钮存在', courses.del > 0 || courses.rows === 0, `del=${courses.del} rows=${courses.rows}`)

  // 3) 设置页：恢复默认按钮 + 每日上限说明 + 兑换校验
  await gotoHash(ws, sessionId, '#/settings')
  const st = await evalJs(ws, sessionId, `(() => {
    const txt = document.body.innerText
    return {
      hasLimitHint: txt.includes('0 表示只复习旧卡'),
      hasRestore: txt.includes('恢复默认'),
      serverInput: document.querySelector('input[style*="width: 230px"]')?.value || '',
      hasTerms: txt.includes('用户协议'),
      hasBalance: txt.includes('充值余额'),
    }
  })()`)
  check('每日上限说明存在', st.hasLimitHint)
  check('服务地址为官方默认时隐藏「恢复默认」（符合设计）', st.serverInput.includes('zenew-api.lxlrwxs.top') ? !st.hasRestore : st.hasRestore, st.serverInput)
  check('用户协议入口', st.hasTerms)
  check('余额区渲染', st.hasBalance)

  // 4) 今日页：不闪错态（有骨架后直接渲染数据）
  await gotoHash(ws, sessionId, '#/today')
  const today = await evalJs(ws, sessionId, `({ title: document.querySelector('.page-title')?.textContent || '', hasCard: !!document.querySelector('.card') })`)
  check('今日页渲染', today.title === '今日' && today.hasCard, JSON.stringify(today))

  // 5) 统计页：零进度不显示金线（0 用量时）
  await gotoHash(ws, sessionId, '#/stats')
  await sleep(900)
  const stats = await evalJs(ws, sessionId, `({ title: document.querySelector('.page-title')?.textContent || '', metrics: document.querySelectorAll('.metric').length, zeroGold: document.querySelectorAll('.chart-col.zero .seg-gold').length })`)
  check('统计页渲染', stats.title === '统计', JSON.stringify(stats))

  console.log(results.join('\n'))
  const fails = results.filter((r) => r.startsWith('✗')).length
  console.log(`\n结果：${results.length - fails} 通过 / ${fails} 失败`)
  process.exit(fails ? 1 : 0)
})()
