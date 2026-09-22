import { useEffect, useRef, useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'
import { checkUpdate, applyUpdate } from '../updater'
import { isTauri } from '../db'

type Phase = 'boot' | 'checking' | 'idle' | 'available' | 'downloading' | 'restarting' | 'error'

const mb = (n: number) => (n / 1048576).toFixed(1)

/**
 * 标题栏更新胶囊：替换旧版本号位。
 * 启动静默检查 + 每 30 分钟；静默检查失败不显眼——保持上次状态（boot 态保持胶囊隐藏），
 * 只有用户手动点「检查」失败才显示「重试」。已是最新（idle）时显示当前版本号。
 */
export default function UpdatePill() {
  const [phase, setPhase] = useState<Phase>('boot')
  const [pct, setPct] = useState(0)
  const [bytes, setBytes] = useState<{ got: number; total: number | null }>({ got: 0, total: null })
  const updRef = useRef<Update | null>(null)
  const phaseRef = useRef<Phase>('boot')
  phaseRef.current = phase

  const runCheck = async (silent = true) => {
    if (!isTauri()) return
    // 下载/重启进行中不打断（防并发二次下载）
    if (phaseRef.current === 'downloading' || phaseRef.current === 'restarting') return
    if (!silent) setPhase('checking')
    const u = await checkUpdate().catch(() => undefined)
    if (u === undefined) {
      // 检查失败：
      //  - 静默检查失败 → 不打扰用户：保持当前显示（boot/idle 等原样），只有「手动检查中」才落错误态
      //  - 手动检查失败 → 显示「重试」（用户有明确预期，需要入口）
      if (!silent && phaseRef.current === 'checking') setPhase('error')
      return
    }
    if (u) {
      updRef.current = u
      setPhase('available')
    } else {
      updRef.current = null
      setPhase('idle')
    }
  }

  useEffect(() => {
    // 启动静默检查 + 每 30 分钟（静默）
    runCheck(true)
    const t = setInterval(() => runCheck(true), 30 * 60 * 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = async () => {
    const u = updRef.current
    if (!u || phaseRef.current === 'downloading') return
    setPhase('downloading')
    setPct(0)
    setBytes({ got: 0, total: null })
    try {
      await applyUpdate(u, (received, total) => {
        setBytes({ got: received, total })
        setPct(total ? Math.min(100, Math.round((received / total) * 100)) : 0)
      })
      setPhase('restarting')
      // relaunch 偶发失败时不卡死在「即将重启」
      await new Promise((r) => setTimeout(r, 4000))
      setPhase((p) => (p === 'restarting' ? 'error' : p))
    } catch {
      setPhase('error')
    }
  }

  if (phase === 'boot') {
    // 静默检查没出结果（或失败）：什么都不显示——已是最新时标题栏保持干净
    return null
  }
  if (phase === 'checking') {
    // 只有手动点检查才会进这里；静默后台检查不打扰
    return <span className="update-pill">检查中…</span>
  }
  if (phase === 'idle') {
    // 已是最新：不显示任何东西（用户要求：没新版本就不显示）
    return null
  }
  if (phase === 'available') {
    return (
      <button className="update-pill is-avail" title="有新版本 · 点击立即更新（免安装，完成后自动重启）" onClick={start}>
        更新
      </button>
    )
  }
  if (phase === 'downloading') {
    const hover = bytes.total
      ? `已下载 ${mb(bytes.got)} / ${mb(bytes.total)} MB`
      : `已下载 ${mb(bytes.got)} MB`
    return (
      <span className="update-pill is-dl" title={hover}>
        {bytes.total ? `更新 ${pct}%` : `更新中 ${mb(bytes.got)} MB`}
        {bytes.total ? (
          <span className="mini-bar"><i style={{ width: `${pct}%` }} /></span>
        ) : null}
      </span>
    )
  }
  if (phase === 'restarting') {
    return <span className="update-pill is-ok" title="更新包已就绪，应用即将自动重启">即将重启</span>
  }
  return (
    <button
      className="update-pill is-err"
      title="检查/下载失败，点击重试；连续失败可到 lxlrwxs.top/zenew/ 下载安装包"
      onClick={() => {
        if (updRef.current) start()
        else runCheck(false)
      }}
    >
      重试
    </button>
  )
}
