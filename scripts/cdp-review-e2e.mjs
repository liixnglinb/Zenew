// Zenew M1 复习闭环专项验收：hash 导航 + 状态机驱动 + 截图
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

async function main() {
  const ws = new WebSocket(await getWsUrl())
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  const c = new Cdp(ws)
  const log = (...a) => console.log('[review-e2e]', ...a)
  await sleep(800)

  // 直接 hash 导航到今日页
  await c.eval(`location.hash = '#/today'`); await sleep(900)
  log('今日页:', (await c.eval(`document.querySelector('.main-inner')?.innerText.slice(0,140).replace(/\\n/g,' | ')`)))

  // 开始学习
  await c.eval(`[...document.querySelectorAll('button')].find(b=>/开始学习/.test(b.textContent))?.click()`)
  await sleep(1400)
  const onReview = await c.eval(`!!document.querySelector('.review-stage')`)
  log('进入复习会话:', onReview)
  if (!onReview) {
    log('复习页未打开，当前:', await c.eval(`location.hash + ' | ' + document.body.innerText.slice(0,150)`))
    process.exit(1)
  }

  // 状态机循环
  let done = 0
  for (let step = 0; step < 60; step++) {
    const phase = await c.eval(`(() => {
      if (/本次学习完成|没有待学习的卡片/.test(document.body.innerText)) return 'DONE'
      const fresh = [...document.querySelectorAll('.choice-btn')].filter(b => !b.classList.contains('right') && !b.classList.contains('wrong'))
      if (fresh.length) return 'CHOICE'
      if (document.querySelector('.grade-row')) return 'GRADE'
      if ([...document.querySelectorAll('button')].some(b=>/先回忆/.test(b.textContent))) return 'REVEAL'
      if ([...document.querySelectorAll('button')].some(b=>/下一张|完成/.test(b.textContent))) return 'NEXT'
      return 'UNKNOWN'
    })()`)
    if (phase === 'DONE') break
    if (phase === 'CHOICE') {
      // 交替答对/答错，制造多样复习数据
      await c.eval(`(() => {
        const fresh = [...document.querySelectorAll('.choice-btn')].filter(b => !b.classList.contains('right') && !b.classList.contains('wrong'))
        fresh[${step % 2 === 0 ? 'fresh.length-1' : '0'}]?.click()
      })()`)
    } else if (phase === 'REVEAL') {
      await c.eval(`[...document.querySelectorAll('button')].find(b=>/先回忆/.test(b.textContent))?.click()`)
    } else if (phase === 'GRADE') {
      await c.eval(`[...document.querySelectorAll('.grade-row button')][${step % 2 === 0 ? 3 : 0}]?.click()`)
    } else if (phase === 'NEXT') {
      await c.eval(`[...document.querySelectorAll('button')].find(b=>/下一张|完成/.test(b.textContent))?.click()`)
    } else {
      log('未知状态，页面:', await c.eval(`document.body.innerText.slice(0,120).replace(/\\n/g,'|')`))
      break
    }
    await sleep(550)
    done++
  }
  await sleep(700)
  log(`互动 ${done} 步，结束页:`, (await c.eval(`document.querySelector('.main-inner')?.innerText.slice(0,180).replace(/\\n/g,' | ')`)))
  await c.shot('D:/Zenew/e2e-review.png')
  log('截图: D:/Zenew/e2e-review.png')

  // 统计页
  await c.eval(`location.hash = '#/stats'`); await sleep(1000)
  log('统计页:', (await c.eval(`document.querySelector('.main-inner')?.innerText.slice(0,240).replace(/\\n/g,' | ')`)))
  await c.shot('D:/Zenew/e2e-stats.png')
  process.exit(0)
}

main().catch((e) => { console.error('[review-e2e] 失败:', e.message); process.exit(1) })
