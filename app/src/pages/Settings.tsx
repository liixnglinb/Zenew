import { useState } from 'react'
import { getServer, setServer } from '../api'

export default function SettingsPage() {
  const [server, setServerUrl] = useState(getServer())
  const [saved, setSaved] = useState(false)
  const [newLimit, setNewLimit] = useState(localStorage.getItem('zenew_new_limit') || '10')

  return (
    <div>
      <div className="page-title">设置</div>
      <div className="page-sub">学习数据保存在本机 SQLite；AI 生成经云端网关（密钥只在服务端）</div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 10 }}>服务地址</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input className="input" value={server} onChange={(e) => setServerUrl(e.target.value)} />
          <button
            className="btn btn-primary"
            onClick={() => {
              setServer(server)
              setSaved(true)
              setTimeout(() => setSaved(false), 1500)
            }}
          >
            保存
          </button>
        </div>
        {saved && <div className="muted" style={{ marginTop: 6, color: 'var(--ok)' }}>已保存</div>}
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 10 }}>每日新学上限</div>
        <input
          className="input"
          style={{ width: 120 }}
          value={newLimit}
          onChange={(e) => setNewLimit(e.target.value.replace(/\D/g, ''))}
          onBlur={() => localStorage.setItem('zenew_new_limit', newLimit || '10')}
        />
        <div className="muted" style={{ marginTop: 6 }}>每天最多引入多少张新卡片（防止"复习债"越滚越多）</div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>关于</div>
        <div className="muted">
          知新 Zenew v0.1.0（M1）· 调度算法 FSRS（ts-fsrs）· 温故而知新
        </div>
      </div>
    </div>
  )
}
