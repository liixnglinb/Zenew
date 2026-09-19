import { useState } from 'react'
import { getServer, setServer } from '../api'

export default function SettingsPage() {
  const [server, setServerUrl] = useState(getServer())
  const [saved, setSaved] = useState(false)
  const [newLimit, setNewLimit] = useState(localStorage.getItem('zenew_new_limit') || '10')

  return (
    <div className="page-in">
      <div className="kicker">SETTINGS</div>
      <div className="page-title">设置</div>

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
        <div className="section-label" style={{ marginTop: 18 }}>ABOUT</div>
        <div className="settings-row">
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500, fontSize: 13.5 }}>知新 Zenew</div>
          </div>
          <span className="tag tag-mono">v0.1.0 · FSRS</span>
        </div>
      </div>
    </div>
  )
}
