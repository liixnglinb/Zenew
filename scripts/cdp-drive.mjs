// 用 Node 22 内置 WebSocket 通过 CDP 驱动 Zenew 窗口（WebView2 远调试）
// 用法: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 下启动 tauri dev 后:
//   node scripts/cdp-drive.mjs
const PORT = process.env.CDP_PORT || '9222'

async function getWsUrl() {
  const resp = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const tabs = await resp.json()
  const page = tabs.find((t) => t.type === 'page' && !/devtools/i.test(t.url))
  if (!page) throw new Error('未找到 Zenew 页面: ' + JSON.stringify(tabs.map((t) => t.url)))
  return page.webSocketDebuggerUrl
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
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
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 500))
    return r.result?.value
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// React 受控输入：需要用原生 setter 触发
function setInputJs(selector, value) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return 'MISSING:' + ${JSON.stringify(selector)}
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return 'OK'
  })()`
}

async function main() {
  const ws = new WebSocket(await getWsUrl())
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  const cdp = new Cdp(ws)
  const log = (...a) => console.log('[drive]', ...a)

  await sleep(1500)
  const title = await cdp.eval('document.title')
  log('窗口标题:', title)

  // ---- 登录 ----
  const hasAuth = await cdp.eval("!!document.querySelector('.auth-box')")
  if (hasAuth) {
    log('登录页出现，填入测试账号')
    await cdp.eval(setInputJs('.auth-box input:nth-of-type(1), .auth-box input', 'e2e@zenew.app'))
    // 两个 input：邮箱与密码（第二个是 password）
    const inputs = await cdp.eval("document.querySelectorAll('.auth-box input').length")
    log('输入框数量:', inputs)
    await cdp.eval(setInputJs('.auth-box input[type="password"]', 'zenew12345'))
    // 邮箱框是第一个 text input
    await cdp.eval(`(() => {
      const el = document.querySelector('.auth-box input:not([type="password"])')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, 'e2e@zenew.app')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return 'OK'
    })()`)
    await cdp.eval("[...document.querySelectorAll('button')].find(b => /登录|注册/.test(b.textContent))?.click()")
    await sleep(1500)
    log('登录后页面:', await cdp.eval("document.querySelector('.brand')?.textContent || document.body.innerText.slice(0,80)"))
  } else {
    log('已在应用内（无登录页）')
  }

  // ---- 今日页 ----
  await sleep(800)
  log('今日页文本:', (await cdp.eval("document.querySelector('.main-inner')?.innerText?.slice(0, 200) || 'EMPTY'")).replace(/\n/g, ' | '))

  // ---- 课程页 ----
  await cdp.eval("[...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('课程'))?.click()")
  await sleep(1000)
  log('课程页:', (await cdp.eval("document.querySelector('.main-inner')?.innerText?.slice(0, 300) || 'EMPTY'")).replace(/\n/g, ' | '))

  // ---- 新建课程（走 mock 网关）----
  await cdp.eval(setInputJs('.card input.input', '大学物理'))
  await cdp.eval("[...document.querySelectorAll('button')].find(b => b.textContent.includes('生成大纲'))?.click()")
  await sleep(2500)
  log('新建后:', (await cdp.eval("document.querySelector('.main-inner')?.innerText?.slice(0, 400) || 'EMPTY'")).replace(/\n/g, ' | '))

  log('阶段一（登录/课程/生成大纲）完成。窗口保持打开，可继续人工或脚本操作。')
  process.exit(0)
}

main().catch((e) => {
  console.error('[drive] 失败:', e.message)
  process.exit(1)
})
