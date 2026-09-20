import { useEffect, useRef, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import type { Update } from '@tauri-apps/plugin-updater'
import { checkUpdate, applyUpdate } from '../updater'
import { isTauri } from '../db'

type Phase = 'checking' | 'idle' | 'available' | 'downloading' | 'restarting' | 'error'

const mb = (n: number) => (n / 1048576).toFixed(1)

/** 标题栏更新胶囊：替换旧版本号位。自动检查（启动+每30分钟），静默检查不闪 UI；
 *  四态切换：idle 已是最新 / available 新版本（点击更新）/ downloading 进度（悬停看 MB）/ restarting 即将重启 */
export default function UpdatePill() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [version, setVersion] = useState('')
  const [pct, setPct] = useState(0)
  const [bytes, setBytes] = useState<{ got: number; total: number | null }>({ got: 0, total: null })
  const updRef = useRef<Update | null>(null)
  const phaseRef = useRef<Phase>('checking')
  phaseRef.current = phase
  const [curVer, setCurVer] = useState('')

  const runCheck = async (silent = true) => {
    if (!isTauri()) return
    // 下载/重启进行中不打断（防并发二次下载）
    if (phaseRef.current === 'downloading' || phaseRef.current === 'restarting') return
    if (!silent) setPhase('checking')
    const u = await checkUpdate().catch(() => undefined)
    if (u === undefined) {
      // 检查失败（网络断等）：不伪装成最新，仅在空闲态提示
      if (phaseRef.current === 'checking' || phaseRef.current === 'idle') setPhase('error')
      return
    }
    if (u) {
      updRef.current = u
      setVersion(u.version)
      setPhase('available')
    } else {
      updRef.current = null
      setPhase('idle')
    }
  }

  useEffect(() => {
    // 当前版本号（idle 态显示，回答「我现在是什么版本」）
    if (isTauri()) getVersion().then((v) => setCurVer(v)).catch(() => {})
    // 启动静默检查 + 每 30 分钟（静默，不闪「检查中」）
    runCheck(true)
    const t = setInterval(() => runCheck(true), 30 * 60 * 1000)
    return () => clearInterval(t)
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

  if (phase === 'checking') {
    return <span className="update-pill">检查中…</span>
  }
  if (phase === 'idle') {
    return (
      <button className="update-pill" title={`自动检查更新 · 点击再次检查${curVer ? ` · 当前 v${curVer}` : ''}`} onClick={() => runCheck(false)}>
        {curVer ? `v${curVer} · 最新` : '已是最新'}
      </button>
    )
  }
  if (phase === 'available') {
    return (
      <button className="update-pill is-avail" title="点击立即更新（免安装，完成后自动重启）" onClick={start}>
        新版本 {version}
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
