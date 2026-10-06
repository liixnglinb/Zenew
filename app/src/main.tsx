import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import './desktop.css'
import App from './App.tsx'

// 全局兜底（模块二）：渲染崩溃由 App.tsx 的 ErrorBoundary 按路由接住；
// 这里接漏网的同步异常与 Promise 拒绝，打到 console 留痕（WebView2 DevTools / CDP 可见），不打印任何用户数据
window.addEventListener('error', (e) => {
  console.error('[zenew] 未捕获异常:', e.message, `${e.filename}:${e.lineno}`)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[zenew] 未处理的 Promise 拒绝:', String((e as PromiseRejectionEvent).reason).slice(0, 300))
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
