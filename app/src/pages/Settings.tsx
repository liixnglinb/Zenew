import { useState, useEffect } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { getServer, setServer } from '../api'
import { checkUpdate, applyUpdate, type UpdateInfo } from '../updater'
import { isTauri } from '../db'

export default function SettingsPage() {
  const [server, setServerUrl] = useState(getServer())
  const [saved, setSaved] = useState(false)
  const [newLimit, setNewLimit] = useState(localStorage.getItem('zenew_new_limit') || '10')
  const [checking, setChecking] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const [ver, setVer] = useState('')

  // 启动即静默检查一次 + 读取真实版本号（更新后能反映新二进制）
  useEffect(() => {
    if (isTauri()) getVersion().then((v) => setVer('v' + v)).catch(() => setVer('dev'))
    else setVer('dev')
    checkUpdate().then((u) => {
      if (u) setUpdate({ version: u.version, notes: u.body ?? null })
    })
  }, [])

  const runCheck = async () => {
    setChecking(true)
    setMsg('')
    const u = await checkUpdate()
    setUpdate(u ? { version: u.version, notes: u.body ?? null } : null)
    setMsg(u ? '' : '已是最新版本')
    setChecking(false)
  }

  const doUpdate = async () => {
    const u = await checkUpdate()
    if (!u) return
    setProgress(0)
    try {
      await applyUpdate(u, (received, total) => {
        setProgress(total ? Math.round((received / total) * 100) : null)
      })
    } catch (e) {
      console.error(e)
      setMsg('更新下载失败，请稍后再试')
      setProgress(null)
    }
  }

  return (
    <div className="page-in">
      <div className="kicker">SETTINGS</div>
      <div className="page-title">设置</div>

      {update && !progress && (
        <div className="update-banner fade-up" style={{ marginTop: 22 }}>
          <div>
            <b>新版本 {update.version} 可用</b>
            <span>免安装更新：后台下载后自动替换重启</span>
          </div>
          <button className="btn btn-primary btn-sm" onClick={doUpdate}>立即更新</button>
        </div>
      )}
      {progress !== null && (
        <div className="update-banner fade-up" style={{ marginTop: 22 }}>
          <div>
            <b>正在下载更新{progress !== null ? ` · ${progress}%` : '…'}</b>
            <span>完成后自动重启</span>
          </div>
          <div className="bar" style={{ width: 140 }}><span className="seg-gold" style={{ width: `${progress}%` }} /></div>
        </div>
      )}

      <div style={{ marginTop: 26 }}>
        <div className="section-label">SERVER</div>
        <div className="settings-row">
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500, fontSize: 13.5 }}>服务地址</div>
          </div>
          <input className="input" style={{ width: 230 }} value={server} onChange={(e) => setServerUrl(e.target.value)} />
          <button
            className="btn btn-sm"
            onClick={() => {
              setServer(server)
              setSaved(true)
              setTimeout(() => setSaved(false), 1500)
            }}
          >
            {saved ? '已保存' : '保存'}
          </button>
        </div>
        <div className="section-label" style={{ marginTop: 18 }}>SCHEDULING</div>
        <div className="settings-row">
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500, fontSize: 13.5 }}>每日新学上限</div>
          </div>
          <input
            className="input"
            style={{ width: 80, textAlign: 'right' }}
            value={newLimit}
            onChange={(e) => setNewLimit(e.target.value.replace(/\D/g, ''))}
            onBlur={() => localStorage.setItem('zenew_new_limit', newLimit || '10')}
          />
        </div>
        <div className="section-label" style={{ marginTop: 18 }}>UPDATES</div>
        <div className="settings-row">
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500, fontSize: 13.5 }}>检查更新</div>
            <div className="row-meta" style={{ fontFamily: 'var(--mono)', fontSize: 10.5 }}>{msg || '自动检查 GitHub Releases'}</div>
          </div>
          <button className="btn btn-sm" disabled={checking || progress !== null} onClick={runCheck}>
            {checking ? '检查中…' : '检查'}
          </button>
        </div>
        <div className="section-label" style={{ marginTop: 18 }}>ABOUT</div>
        <div className="settings-row">
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500, fontSize: 13.5 }}>知新 Zenew</div>
          </div>
          <span className="tag tag-mono">{ver || '…'} · FSRS</span>
        </div>
      </div>
    </div>
  )
}
