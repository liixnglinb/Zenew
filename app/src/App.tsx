import { HashRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { BookOpen, BarChart3, CalendarDays, Coins, Home, LogOut, Settings } from 'lucide-react'
import { ApiError, fetchMe, getToken, setToken, type Me } from './api'
import { isTauri, ensureSchema } from './db'
import { watchTopup, type TopupEvent } from './topup'
import TitleBar from './components/TitleBar'
import Login from './pages/Login'
import Today from './pages/Today'
import Courses from './pages/Courses'
import CourseDetail from './pages/CourseDetail'
import ReviewSession from './pages/ReviewSession'
import Stats from './pages/Stats'
import SettingsPage from './pages/Settings'
import Exams from './pages/Exams'
import Vocab from './pages/Vocab'
import VocabStudy from './pages/VocabStudy'
import Dict from './pages/Dict'

function Shell({ banner, onDismissBanner }: { banner: string; onDismissBanner: () => void }) {
  const nav = useNavigate()
  const location = useLocation()
  // 复习会话是沉浸场景：不显示侧栏与横幅（全屏与否都聚焦在卡片上）
  const immersive = location.pathname.startsWith('/review') || /^\/vocab\/[^/]+$/.test(location.pathname)
  // 侧栏余额卡片：进入应用/到账后刷新（banner 变化即到账 → 重新拉 /me）
  const [quota, setQuota] = useState<{ balance: number; free: number; total: number } | null>(null)
  useEffect(() => {
    if (immersive) return
    let dead = false
    fetchMe()
      .then((m) => {
        if (!dead) setQuota({ balance: m.balance_tokens || 0, free: Math.max(0, m.quota_tokens - m.used_tokens), total: m.quota_tokens || 0 })
      })
      .catch(() => {})
    return () => { dead = true }
  }, [immersive, banner])
  const freePct = quota && quota.total > 0 ? Math.min(100, (quota.free / quota.total) * 100) : 0
  return (
    <div className={`shell${immersive ? ' immersive' : ''}`}>
      <div className="ambient" style={{ width: 420, height: 420, top: -140, right: -120, background: 'radial-gradient(circle, var(--gold-glow) 0%, rgba(255,224,138,0) 70%)' }} />
      <div className="ambient" style={{ width: 380, height: 380, bottom: -160, right: 240, animationDelay: '3s', background: 'radial-gradient(circle, var(--gold-glow) 0%, rgba(255,224,138,0) 70%)' }} />
      {!immersive && (
      <aside className="sidebar">
        <div className="brand">
          知新
          <small>ZENEW</small>
        </div>
        <div style={{ height: 14 }} />
        <NavLink to="/today" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <Home size={15} /> 今日
        </NavLink>
        <NavLink to="/courses" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <BookOpen size={15} /> 课程
        </NavLink>
        <NavLink to="/vocab" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <BookOpen size={15} /> 词书
        </NavLink>
        <NavLink to="/exams" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <CalendarDays size={15} /> 考试
        </NavLink>
        <NavLink to="/stats" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <BarChart3 size={15} /> 统计
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <Settings size={15} /> 设置
        </NavLink>
        {quota && (
          <div
            className="side-balance fade-up"
            title="点击查看余额与充值"
            onClick={() => nav('/settings')}
          >
            <div className="side-balance-label">BALANCE</div>
            <div className="side-balance-num">
              {(quota.balance / 10000).toFixed(0)}
              <small>万 tokens</small>
            </div>
            <div className="side-balance-row">
              <div className="side-balance-bar">
                <span style={{ width: `${freePct}%` }} />
              </div>
              <span className="side-balance-free">
                <Coins size={9} style={{ verticalAlign: -1 }} /> 免费 {(quota.free / 10000).toFixed(1)} 万
              </span>
            </div>
          </div>
        )}
        <div className="spacer" />
        <button
          className="nav-item"
          onClick={() => {
            setToken(null)
            nav('/login')
          }}
        >
          <LogOut size={15} /> 退出登录
        </button>
      </aside>
      )}
      <main className="main">
        <div className="main-inner">
          {banner && !immersive && (
            <div className="update-banner fade-up" style={{ marginBottom: 18 }}>
              <div>
                <b>{banner}</b>
                <span>余额已更新，可直接使用</span>
              </div>
              <button className="btn btn-sm" onClick={onDismissBanner}>
                知道了
              </button>
            </div>
          )}
          <Routes>
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route path="/today" element={<Today />} />
            <Route path="/courses" element={<Courses />} />
            <Route path="/courses/:id" element={<CourseDetail />} />
            <Route path="/vocab" element={<Vocab />} />
            <Route path="/vocab/:key" element={<VocabStudy />} />
            <Route path="/dict" element={<Dict />} />
            <Route path="/exams" element={<Exams />} />
            <Route path="/review" element={<ReviewSession />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)
  const [offline, setOffline] = useState(false)
  const [banner, setBanner] = useState('')

  useEffect(() => {
    ;(async () => {
      if (isTauri()) {
        try {
          await ensureSchema()
        } catch (e) {
          console.error('数据库初始化失败', e)
        }
      }
      if (getToken()) {
        try {
          setMe(await fetchMe())
          setOffline(false)
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) setToken(null)
          else setOffline(true) // 服务器不可达：允许离线浏览本地内容
        }
      }
      setReady(true)
    })()
    // 会话中途 token 失效（api 层广播）→ 立即回登录页，避免僵尸态
    const onUnauthorized = () => setMe(null)
    window.addEventListener('zenew:unauthorized', onUnauthorized)
    return () => window.removeEventListener('zenew:unauthorized', onUnauthorized)
  }, [])

  // 充值到账监听：全局常驻（无论当前在哪个页面，付款确认后都能识别并提示）
  useEffect(() => {
    if (!me) return
    const off = watchTopup((e: TopupEvent) => {
      if (e.kind === 'paid' && e.added && e.added > 0) {
        setBanner(`充值到账 +${(e.added / 10000).toFixed(0)} 万 tokens`)
      } else if (e.kind === 'paid') {
        setBanner('订单已支付，请到设置页兑换卡密')
      }
      if (isTauri()) {
        import('@tauri-apps/api/window')
          .then(({ getCurrentWindow }) => getCurrentWindow().setFocus())
          .catch(() => {})
      }
    })
    return off
  }, [me])

  if (!ready) return null
  if (!me) return <Login onLogin={(m) => setMe({ email: m.email, used_tokens: 0, quota_tokens: 0 })} />
  void offline
  return (
    <HashRouter>
      <TitleBar />
      <Shell banner={banner} onDismissBanner={() => setBanner('')} />
    </HashRouter>
  )
}
