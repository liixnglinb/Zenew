import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { getCurrentWindow, LogicalPosition, LogicalSize } from '@tauri-apps/api/window'
import { X } from 'lucide-react'

const WIN_KEY = 'zenew_window'
const ROUTE_KEY = 'zenew_last_route'
const NAV_KEY = 'zenew_nav_collapsed'

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

interface StoredWindow {
  width?: number
  height?: number
  x?: number
  y?: number
  maximized?: boolean
}

function readWin(): StoredWindow | null {
  try {
    const raw = localStorage.getItem(WIN_KEY)
    return raw ? (JSON.parse(raw) as StoredWindow) : null
  } catch {
    return null
  }
}

function writeWin(v: StoredWindow) {
  try {
    localStorage.setItem(WIN_KEY, JSON.stringify(v))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/**
 * 桌面窗口记忆：记住尺寸、位置与最大化状态，下次打开原样恢复。
 * 非 Tauri 环境（浏览器预览）静默跳过，不抛异常。
 */
export function useWindowState(): void {
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    const win = getCurrentWindow()
    let timer: number | undefined

    const persist = async () => {
      if (disposed) return
      try {
        if (await win.isMaximized()) {
          writeWin({ ...(readWin() ?? {}), maximized: true })
          return
        }
        const [size, pos, sf] = await Promise.all([win.outerSize(), win.outerPosition(), win.scaleFactor()])
        writeWin({
          width: Math.round(size.width / sf),
          height: Math.round(size.height / sf),
          x: Math.round(pos.x / sf),
          y: Math.round(pos.y / sf),
          maximized: false,
        })
      } catch {
        /* 窗口已关闭等情况忽略 */
      }
    }
    const schedule = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => void persist(), 400)
    }

    const restore = async () => {
      const saved = readWin()
      if (!saved || disposed) return
      try {
        if (saved.maximized) {
          await win.maximize()
          return
        }
        if (saved.width && saved.height) await win.setSize(new LogicalSize(saved.width, saved.height))
        if (typeof saved.x === 'number' && typeof saved.y === 'number') {
          await win.setPosition(new LogicalPosition(saved.x, saved.y))
        }
      } catch {
        /* 恢复失败就用配置里的默认尺寸 */
      }
    }
    void restore()

    const unlisten: Array<() => void> = []
    win.onResized(schedule).then((u) => unlisten.push(u)).catch(() => {})
    win.onMoved(schedule).then((u) => unlisten.push(u)).catch(() => {})

    return () => {
      disposed = true
      if (timer) window.clearTimeout(timer)
      unlisten.forEach((u) => u())
    }
  }, [])
}

/** 记住上次停留的页面，下次打开直接回到那里 */
export function useLastRoute(): void {
  const location = useLocation()
  useEffect(() => {
    try {
      localStorage.setItem(ROUTE_KEY, `${location.pathname}${location.search}`)
    } catch {
      /* 忽略 */
    }
  }, [location.pathname, location.search])
}

export function getLastRoute(): string | null {
  try {
    const v = localStorage.getItem(ROUTE_KEY)
    return v && v.startsWith('/') ? v : null
  } catch {
    return null
  }
}

export function loadNavCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_KEY) === '1'
  } catch {
    return false
  }
}

export function saveNavCollapsed(v: boolean): void {
  try {
    localStorage.setItem(NAV_KEY, v ? '1' : '0')
  } catch {
    /* 忽略 */
  }
}

/* ============================================================
   键盘操作
   ============================================================ */

export type HotkeyHandler = (event: KeyboardEvent) => void
export type HotkeyMap = Record<string, HotkeyHandler>

/** 焦点在输入框 / 文本域 / 可编辑区域时不应触发单键快捷键 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return el.isContentEditable === true
}

function comboOf(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('ctrl')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  if (event.metaKey) parts.push('meta')
  const key = event.key === ' ' ? 'space' : event.key.toLowerCase()
  parts.push(key)
  return parts.join('+')
}

/** `mod` 在 Windows / Linux 上映射 Ctrl；绑定串大小写不敏感 */
function normalize(binding: string): string {
  return binding
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .map((p) => (p === 'mod' ? 'ctrl' : p === 'esc' ? 'escape' : p === 'return' ? 'enter' : p))
    .join('+')
}

/**
 * 全局快捷键。用法：
 *   useHotkeys({ 'mod+k': () => nav('/dict'), 'ctrl+1': () => nav('/today') })
 * 单键绑定（如 'space'、'1'）在输入框聚焦时会自动忽略。
 */
export function useHotkeys(map: HotkeyMap): void {
  useEffect(() => {
    const entries = Object.entries(map).map(([k, fn]) => [normalize(k), fn] as const)
    const onKeyDown = (event: KeyboardEvent) => {
      const hasModifier = event.ctrlKey || event.altKey || event.metaKey
      if (!hasModifier && isTypingTarget(event.target)) return
      const combo = comboOf(event)
      for (const [binding, fn] of entries) {
        if (binding !== combo) continue
        event.preventDefault()
        fn(event)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [map])
}

interface ShortcutGroup {
  title: string
  rows: [string, string][]
}

const GROUPS: ShortcutGroup[] = [
  {
    title: '全局',
    rows: [
      ['Ctrl + 1…8', '单词 / 学习 / 词书 / 查词 / 统计 / 任务 / 排行榜 / 我的'],
      ['Ctrl + K', '跳到查词并聚焦搜索框'],
      ['Ctrl + B', '折叠 / 展开左侧导航栏'],
      ['Ctrl + /', '打开本快捷键说明'],
      ['F11', '全屏 / 退出全屏'],
      ['Esc', '返回上一页 / 关闭弹层'],
    ],
  },
  {
    title: '学习页',
    rows: [
      ['1 2 3 4', '选择对应答案'],
      ['空格', '翻面 / 继续'],
      ['Enter', '继续'],
      ['← →', '上一词 / 下一词'],
      ['S', '斩掉这个词'],
      ['P', '朗读单词'],
      ['Esc', '退出学习'],
    ],
  },
  {
    title: '列表',
    rows: [
      ['↑ ↓', '在选项中移动焦点'],
      ['Enter', '打开当前项'],
      ['右键', '更多操作（朗读 / 斩词 / 复制）'],
    ],
  },
]

/** 快捷键说明弹窗（纯 CSS 类，不依赖其它组件） */
export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="modal-mask" role="presentation" onClick={onClose}>
      <div
        className="modal shortcuts"
        role="dialog"
        aria-modal="true"
        aria-label="键盘快捷键"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-head">
          <h2 className="modal-title">键盘快捷键</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          {GROUPS.map((g) => (
            <section key={g.title} className="shortcuts-group">
              <div className="section-label">{g.title}</div>
              <ul className="shortcuts-list">
                {g.rows.map(([keys, desc]) => (
                  <li key={keys}>
                    <span className="shortcuts-keys">
                      {keys.split(' ').map((k, i) =>
                        k === '…' || k === '/' ? (
                          <span key={i}>{k}</span>
                        ) : (
                          <kbd key={i}>{k}</kbd>
                        )
                      )}
                    </span>
                    <span className="shortcuts-desc">{desc}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
