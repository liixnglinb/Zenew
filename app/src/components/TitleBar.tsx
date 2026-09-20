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
    Promise.all([win.isFullscreen(), win.isMaximized()])
      .then(([a, b]) => {
        setFs(a)
        setMaximized(b)
      })
      .catch(() => {})
    win.onResized(async () => {
      try {
        setFs(await win.isFullscreen())
        setMaximized(await win.isMaximized())
      } catch {}
    })
      .then((f) => (un = f as () => void))
      .catch(() => {})
    return () => un?.()
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
      <div className="titlebar-brand">
        知新
        <small>ZENEW</small>
      </div>
      <UpdatePill />
      <div className="titlebar-spacer" />
      <button className={btn} title="最小化" onClick={() => getCurrentWindow().minimize().catch(() => {})}>
        <Minus size={14} strokeWidth={1.8} />
      </button>
      <button
        className={btn}
        title={maximized ? '还原' : '最大化'}
        onClick={() => getCurrentWindow().toggleMaximize().catch(() => {})}
      >
        {maximized ? <Copy size={12} strokeWidth={1.8} /> : <Square size={12} strokeWidth={1.8} />}
      </button>
      <button className={`${btn} titlebar-close`} title="关闭" onClick={() => getCurrentWindow().close().catch(() => {})}>
        <X size={14} strokeWidth={1.8} />
      </button>
    </header>
  )
}
