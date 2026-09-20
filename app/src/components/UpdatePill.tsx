import { useEffect, useRef, useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'
import { checkUpdate, applyUpdate } from '../updater'
import { isTauri } from '../db'

type Phase = 'checking' | 'idle' | 'available' | 'downloading' | 'restarting' | 'error'

const mb = (n: number) => (n / 1048576).toFixed(1)

/** 标题栏更新胶囊：替换旧版本号位。自动检查（启动+每30分钟），四态切换：
 *  idle 已是最新 / available 新版本（点击更新）/ downloading 进度（悬停看 MB）/ restarting 即将重启 */
export default function UpdatePill() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [version, setVersion] = useState('')
  const [pct, setPct] = useState(0)
  const [bytes, setBytes] = useState<{ got: number; total: number | null }>({ got: 0, total: null })
  const updRef = useRef<Update | null>(null)

  const runCheck = async () => {
    if (!isTauri()) return
    setPhase('checking')
    const u = await checkUpdate()
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
    runCheck()
    const t = setInterval(runCheck, 30 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const start = async () => {
    const u = updRef.current
    if (!u || phase === 'downloading') return
    setPhase('downloading')
    setPct(0)
    setBytes({ got: 0, total: null })
    try {
      await applyUpdate(u, (received, total) => {
        setBytes({ got: received, total })
        setPct(total ? Math.min(100, Math.round((received / total) * 100)) : 0)
      })
      setPhase('restarting')
    } catch {
      setPhase('error')
    }
  }

  if (phase === 'checking') {
    return <span className="update-pill">检查中…</span>
  }
  if (phase === 'idle') {
    return (
      <button className="update-pill" title="自动检查更新 · 点击再次检查" onClick={runCheck}>
        已是最新
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
        更新 {pct}%
        <span className="mini-bar"><i style={{ width: `${pct}%` }} /></span>
      </span>
    )
  }
  if (phase === 'restarting') {
    return <span className="update-pill is-ok" title="更新包已就绪，应用即将自动重启">即将重启</span>
  }
  return (
    <button className="update-pill is-err" title="下载失败，点击重试" onClick={start}>
      重试
    </button>
  )
}
