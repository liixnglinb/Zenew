import type { ComponentType } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  BarChart3,
  BookOpen,
  Flame,
  Home,
  Layers,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Trophy,
  User,
  Zap,
} from 'lucide-react'
import { formatNumber } from '../lib/format'

export interface SideNavProps {
  collapsed: boolean
  onToggleCollapse: () => void
  streak: number
  points: number
}

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ size?: number | string; className?: string; 'aria-hidden'?: boolean }>
  key: string
  /** 是否把该前缀下的子路由也算作当前项 */
  prefix?: boolean
}

/** 主导航：单词 / 学习 / 词书 / 查词 / 统计 / 任务 / 排行榜 / 我的 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/today', label: '单词', icon: Home, key: 'Ctrl+1' },
  { to: '/review', label: '学习', icon: Layers, key: 'Ctrl+2', prefix: true },
  { to: '/vocab', label: '词书', icon: BookOpen, key: 'Ctrl+3', prefix: true },
  { to: '/dict', label: '查词', icon: Search, key: 'Ctrl+4' },
  { to: '/stats', label: '统计', icon: BarChart3, key: 'Ctrl+5' },
  { to: '/tasks', label: '任务', icon: ListChecks, key: 'Ctrl+6' },
  { to: '/rank', label: '排行榜', icon: Trophy, key: 'Ctrl+7' },
  { to: '/settings', label: '我的', icon: User, key: 'Ctrl+8' },
]

function isActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/review') return pathname.startsWith('/review') || /^\/vocab\/[^/]+$/.test(pathname)
  if (item.prefix) return pathname === item.to || pathname.startsWith(`${item.to}/`)
  return pathname === item.to
}

/**
 * 左侧固定导航：桌面软件的常驻导航栏，替代手机式底部 Dock。
 * 折叠后只保留 72px 图标列，键盘与读屏仍可完整操作。
 */
export default function SideNav({ collapsed, onToggleCollapse, streak, points }: SideNavProps) {
  const pathname = useLocation().pathname

  return (
    <nav className={`sidenav${collapsed ? ' is-collapsed' : ''}`} aria-label="主导航">
      <div className="sidenav-brand">
        <span className="sidenav-logo" aria-hidden>
          知
        </span>
        {!collapsed && (
          <span className="sidenav-brand-text">
            <b>知新</b>
            <small>ZENEW</small>
          </span>
        )}
      </div>

      <ul className="sidenav-list">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = isActive(item, pathname)
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={`sidenav-item${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? `${item.label}（${item.key}）` : undefined}
              >
                <Icon size={18} aria-hidden />
                {!collapsed && <span className="sidenav-label">{item.label}</span>}
                {!collapsed && <span className="sidenav-key">{item.key}</span>}
              </NavLink>
            </li>
          )
        })}
      </ul>

      <div className="sidenav-foot">
        <div className="sidenav-stat" title="连续学习天数">
          <Flame size={14} aria-hidden />
          {!collapsed && <span>{formatNumber(streak)} 天</span>}
        </div>
        <div className="sidenav-stat is-points" title="今日学习得分">
          <Zap size={14} aria-hidden />
          {!collapsed && <span>{formatNumber(points)}</span>}
        </div>
        <button
          type="button"
          className="sidenav-toggle"
          onClick={onToggleCollapse}
          aria-label={collapsed ? '展开导航栏' : '折叠导航栏'}
          title={collapsed ? '展开导航栏' : '折叠导航栏（Ctrl+B）'}
        >
          {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
        </button>
      </div>
    </nav>
  )
}
