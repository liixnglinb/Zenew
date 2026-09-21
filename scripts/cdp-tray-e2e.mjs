// 托盘 E2E：点 ✕ → 窗口隐藏进程存活 → 深链/再次启动唤起 → 窗口恢复可见
import { execSync } from 'child_process'
const BASE = 'http://127.0.0.1:9222'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`) }

const appRunning = () => {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq app.exe" /FO CSV', { windowsHide: true }).toString()
    return /app\.exe/i.test(out)
  } catch { return false }
}

// 1) 起始：应用运行中、9222 可连
let list = await (await fetch(`${BASE}/json/list`)).json()
const page0 = list.find((t) => t.type === 'page' && /tauri|localhost/.test(t.url))
ok('应用运行且 CDP 可连', !!page0)

const ws = new WebSocket(page0.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value

// 2) 点标题栏 ✕ → hide()
await evalJs(`(() => { const b = document.querySelector('.titlebar-close'); b && b.click(); return 1 })()`)
await sleep(1200)
ok('点 ✕ 后进程仍存活（隐藏到托盘）', appRunning())

// 3) 窗口隐藏状态（CDP 页面目标仍在，但窗口不可见）——用再次启动实例触发单实例转发 show
execSync('cmd /c start "" "%LOCALAPPDATA%\\Zenew\\app.exe"', { windowsHide: true })
await sleep(2500)
ok('二次启动后进程存活（单实例转发）', appRunning())

// 4) 通过窗口枚举确认可见状态恢复（Windows: 用 PowerShell 查可见窗口标题）
const vis = execSync(
  `powershell -NoProfile -Command "(Get-Process app -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Measure-Object).Count"`,
  { windowsHide: true }
).toString().trim()
ok('主窗口已恢复可见（有主窗口标题）', Number(vis) >= 1, `visibleWindows=${vis}`)

console.log(`\\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
