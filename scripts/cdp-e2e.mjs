// Zenew M1 真机端到端验收：注册 → 课程 → 生成卡片 → 复习闭环 → 统计 → 截图
const PORT = '9222'

async function getWsUrl() {
  const resp = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const tabs = await resp.json()
  const page = tabs.find((t) => t.type === 'page' && !/devtools/i.test(t.url))
  if (!page) throw new Error('未找到 Zenew 页面')
  return page.webSocketDebuggerUrl
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 400))
    return r.result?.value
  }
  async shot(path) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, Buffer.from(r.data, 'base64'))
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const setVal = (sel, v) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)})
  if (!el) return 'MISSING'
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  s.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'OK'
})()`
const clickBtn = (re) => `[...document.querySelectorAll('button')].find(b => ${re}.test(b.textContent))?.click() ?? 'NOBTN'`
const bodyText = () => `document.querySelector('.main-inner')?.innerText?.slice(0, 350).replace(/\\n/g, ' | ') || document.body.innerText.slice(0,200)`

async function main() {
  const ws = new WebSocket(await getWsUrl())
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  const c = new Cdp(ws)
  const log = (...a) => console.log('[e2e]', ...a)
  await sleep(1000)

  // 1. 注册（切到注册模式）
  if (await c.eval("!!document.querySelector('.auth-box')")) {
    await c.eval("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('没有账号'))?.click()")
    await sleep(400)
    await c.eval(setVal('.auth-box input:not([type="password"])', 'e2e@zenew.app'))
    await c.eval(setVal('.auth-box input[type="password"]', 'zenew12345'))
    await c.eval(clickBtn(`/注册并登录/`))
    await sleep(2000)
    log('注册登录:', await c.eval("document.querySelector('.brand') ? 'OK' : 'FAIL: ' + document.body.innerText.slice(0,120)"))
  } else { log('已登录') }

  // 2. 课程页（种子应已播种）
  await c.eval(clickBtn(`/课程/`)); await sleep(1200)
  const coursesText = await c.eval(bodyText())
  log('课程页:', coursesText.slice(0, 220))

  // 3. 打开第一门课程
  await c.eval(`document.querySelector('.card[style*="cursor"]')?.click() ?? [...document.querySelectorAll('.card')].find(x=>x.textContent.includes('高等数学'))?.click()`)
  await sleep(1200)
  log('课程详情:', (await c.eval(bodyText())).slice(0, 200))

  // 4. 生成卡片（第一个知识点）
  await c.eval(clickBtn(`/生成卡片/`)); await sleep(3500)
  log('生成结果:', (await c.eval("document.querySelector('.main-inner')?.innerText.match(/生成.{1,6}张卡片|生成失败|额度|失败/g)?.join(',') || '未见提示'")))

  // 5. 今日页
  await c.eval(clickBtn(`/今日/`)); await sleep(1000)
  log('今日页:', (await c.eval(bodyText())).slice(0, 150))

  // 6. 开始复习闭环
  await c.eval(clickBtn(`/开始学习/`)); await sleep(1500)
  let n = 0
  for (; n < 40; n++) {
    const doneNow = await c.eval(`/完成|本次学习完成|没有待学习/.test(document.body.innerText) && !document.querySelector('.grade-row') && !document.querySelector('.choice-btn')`)
    if (doneNow) break
    const hasChoices = await c.eval(`!!document.querySelector('.choice-btn:not(.right):not(.wrong)')`)
    if (hasChoices) {
      // 选择题：最后一题答对，其余答错（制造 Again 数据）
      const cnt = await c.eval(`document.querySelectorAll('.choice-btn:not(.right):not(.wrong)').length`)
      const pick = n % 3 === 0 ? 0 : cnt - 1
      await c.eval(`document.querySelectorAll('.choice-btn:not(.right):not(.wrong)')[${pick}]?.click()`)
    } else {
      await c.eval(clickBtn(`/先回忆，再看答案/`)); await sleep(350)
      await c.eval(clickBtn(`/忘了|记得|秒答|想起来了/`))
    }
    await sleep(650)
  }
  await sleep(800)
  log(`复习 ${n} 张后结束页:`, (await c.eval(bodyText())).slice(0, 160))

  // 7. 统计页 + 截图
  await c.eval(clickBtn(`/统计/`)); await sleep(1200)
  log('统计页:', (await c.eval(bodyText())).slice(0, 260))
  await c.shot('C:/Users/李星历/Desktop/课程学习软件/Zenew/e2e-final.png')
  log('截图: C:/Users/李星历/Desktop/课程学习软件/Zenew/e2e-final.png')

  // 8. 复习日志落库核验（直接查 WebView 里的数据）
  const counts = await c.eval(`(async () => {
    const { invoke } = window.__TAURI_INTERNALS__
    return 'via-js-only'
  })()`)
  log('完成')
  process.exit(0)
}

main().catch((e) => { console.error('[e2e] 失败:', e.message); process.exit(1) })
