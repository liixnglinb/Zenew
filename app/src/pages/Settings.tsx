import { useState } from 'react'
import { getServer, setServer } from '../api'

export default function SettingsPage() {
  const [server, setServerUrl] = useState(getServer())
  const [saved, setSaved] = useState(false)
  const [newLimit, setNewLimit] = useState(localStorage.getItem('zenew_new_limit') || '10')

  return (
    <div>
      <div className="page-title">设置</div>
      <div className="page-sub">学习数据保存在本机；AI 生成经云端网关，密钥只在服务端</div>

      <div className="section-label">服务</div>
      <div className="rows">
        <div className="row" style={{ cursor: 'default' }}>
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500 }}>服务地址</div>
            <div className="row-meta">生成与账号服务器的地址</div>
          </div>
          <input className="input" style={{ width: 240 }} value={server} onChange={(e) => setServerUrl(e.target.value)} />
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
        <div className="row" style={{ cursor: 'default' }}>
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500 }}>每日新学上限</div>
            <div className="row-meta">每天最多引入多少张新卡，防止「复习债」越滚越多</div>
          </div>
          <input
            className="input"
            style={{ width: 90, textAlign: 'right' }}
            value={newLimit}
            onChange={(e) => setNewLimit(e.target.value.replace(/\D/g, ''))}
            onBlur={() => localStorage.setItem('zenew_new_limit', newLimit || '10')}
          />
        </div>
      </div>

      <div className="section-label" style={{ marginTop: 26 }}>关于</div>
      <div className="rows">
        <div className="row" style={{ cursor: 'default' }}>
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500 }}>知新 Zenew</div>
            <div className="row-meta">v0.1.0（M1）· 调度算法 FSRS（ts-fsrs）· 温故而知新</div>
          </div>
        </div>
      </div>
    </div>
  )
}
