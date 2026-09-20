import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from '../db'
import { Minus, Square, Copy, X } from 'lucide-react'
import UpdatePill from './UpdatePill'

/** 自绘标题栏：无边框窗口的窗口控制 + 顶部拖拽区；进入全屏后自动隐藏 */
export default function TitleBar() {
  const [fs, setFs] = useState(false)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!isTauri()) return
    const win = getCurrentWindow()
    let un: (() => void) | undefined
    let cancelled = false
    Promise.all([win.isFullscreen(), win.isMaximized()])
      .then(([a, b]) => {
        if (cancelled) return
        setFs(a)
        setMaximized(b)
      })
      .catch(() => {})
    let last = 0
    win.onResized(async () => {
      // 拖拽缩放期间高频触发 → 100ms 节流
      const now = Date.now()
      if (now - last < 100) return
      last = now
      try {
        if (cancelled) return
        setFs(await win.isFullscreen())
        setMaximized(await win.isMaximized())
      } catch {}
    })
      .then((f) => {
        un = f as () => void
        if (cancelled) un() // 卸载竞态：resolve 后立即解绑，避免监听器泄漏
      })
      .catch(() => {})
    return () => {
      cancelled = true
      un?.()
    }
  }, [])

  if (!isTauri()) return <div style={{ height: 44 }} />

  const btn = 'titlebar-btn'
  return (
    <header
      data-tauri-drag-region
      className={`titlebar${fs ? ' titlebar-hidden' : ''}`}
      style={{ height: 44 }}
      onDoubleClick={() => getCurrentWindow().toggleMaximize().catch(() => {})}
    >
      <div className="titlebar-brand" data-tauri-drag-region>
        知新
        <small>ZENEW</small>
      </div>
      <UpdatePill />
      <div className="titlebar-spacer" data-tauri-drag-region />
      <button className={btn} title="最小化" aria-label="最小化" onClick={(e) => { e.stopPropagation(); getCurrentWindow().minimize().catch(() => {}) }}>
        <Minus size={14} strokeWidth={1.8} />
      </button>
      <button
        className={btn}
        title={maximized ? '还原' : '最大化'}
        aria-label={maximized ? '还原' : '最大化'}
        onClick={(e) => { e.stopPropagation(); getCurrentWindow().toggleMaximize().catch(() => {}) }}
      >
        {maximized ? <Copy size={12} strokeWidth={1.8} /> : <Square size={12} strokeWidth={1.8} />}
      </button>
      <button className={`${btn} titlebar-close`} title="关闭" aria-label="关闭" onClick={(e) => { e.stopPropagation(); getCurrentWindow().close().catch(() => {}) }}>
        <X size={14} strokeWidth={1.8} />
      </button>
    </header>
  )
}
