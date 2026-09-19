import { HashRouter, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { BookOpen, BarChart3, Home, LogOut, Settings } from 'lucide-react'
import { ApiError, fetchMe, getToken, setToken, type Me } from './api'
import { isTauri, ensureSchema } from './db'
import Login from './pages/Login'
import Today from './pages/Today'
import Courses from './pages/Courses'
import CourseDetail from './pages/CourseDetail'
import ReviewSession from './pages/ReviewSession'
import Stats from './pages/Stats'
import SettingsPage from './pages/Settings'

function Shell() {
  const nav = useNavigate()
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          知新
          <small>ZENEW</small>
        </div>
        <NavLink to="/today" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <Home size={16} /> 今日
        </NavLink>
        <NavLink to="/courses" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <BookOpen size={16} /> 课程
        </NavLink>
        <NavLink to="/stats" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <BarChart3 size={16} /> 统计
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <Settings size={16} /> 设置
        </NavLink>
        <div style={{ flex: 1 }} />
        <button
          className="nav-item"
          onClick={() => {
            setToken(null)
            nav('/login')
          }}
        >
          <LogOut size={16} /> 退出登录
        </button>
      </aside>
      <main className="main">
        <div className="main-inner">
          <Routes>
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route path="/today" element={<Today />} />
            <Route path="/courses" element={<Courses />} />
            <Route path="/courses/:id" element={<CourseDetail />} />
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
  }, [])

  if (!ready) return null
  if (!me) return <Login onLogin={(m) => setMe({ email: m.email, used_tokens: 0, quota_tokens: 0 })} />
  void offline
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  )
}
