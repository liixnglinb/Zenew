// 学习排行榜：赛季横幅（星空只保留为横幅内的渐变光晕）+ 段位 + 领奖台 + 榜单
// 榜单同侪为本地演示数据（用于展示界面结构与交互），「我」的分数由真实学习记录计算。
// 统一使用 src/ui 组件库：PageHeader / Avatar / Tag / Progress / Pagination / 三态 / useToast；
// 整页不再用 .dark-page，全部跟随主题令牌（样式见 src/polish.css）。
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Crown, FastForward, Info, Lock, Medal, RefreshCw, Trophy } from 'lucide-react'
import { getDb } from '../db'
import { loadStreak } from '../study'
import { formatCountdown, formatNumber } from '../lib/format'
import {
  Avatar,
  Button,
  ErrorState,
  IconButton,
  LoadingState,
  PageHeader,
  Pagination,
  Progress,
  Tag,
  useAsync,
  useToast,
} from '../ui'
import '../polish.css'

interface Peer {
  name: string
  score: number
  book: string
  me?: boolean
}

const DEMO_PEERS: Peer[] = [
  { name: 'dear丶', score: 1784, book: '四级词汇大全' },
  { name: '无名大侠', score: 1809, book: '四级高频' },
  { name: '笨蛋小青桂', score: 1777, book: '四级词汇大全' },
  { name: 'hundred', score: 1345, book: '四级词汇大全' },
  { name: '如梦初醒*^_^*', score: 815, book: '四级词汇大全' },
  { name: 'dew', score: 788, book: '四级词汇大全' },
  { name: '碎冰冰', score: 706, book: '四级词汇大全' },
]

const STAGES = [
  { name: '水星', min: 0 },
  { name: '金星', min: 800 },
  { name: '地球', min: 1600 },
  { name: '火星', min: 2400 },
  { name: '木星', min: 3200 },
]

const PAGE_SIZE = 20
const ORDINAL = ['第 1 名', '第 2 名', '第 3 名']
/** 赛季分口径：近 30 天复习数 × REVIEW_WEIGHT + 已学词数 × LEARNED_WEIGHT */
const REVIEW_WEIGHT = 6
const LEARNED_WEIGHT = 2

interface RankData {
  score: number
  learned: number
  streak: number
  peers: Peer[]
}

/** 统计口径与迁移前一致（只算词书单词卡）：赛季分 = 近 30 天复习数 × 6 + 已学词数 × 2 */
async function loadRank(): Promise<RankData> {
  const db = await getDb()
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM review_log rl
     JOIN card c ON c.id = rl.card_id
     JOIN topic t ON t.id = c.topic_id
     JOIN course co ON co.id = t.course_id
     WHERE co.kind = 'vocab' AND c.type = 'word' AND rl.reviewed_at >= ?`,
    [new Date(Date.now() - 30 * 86400000).toISOString()]
  )
  const reviews = Number(rows[0]?.n || 0)
  const l = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM card_state cs
     JOIN card c ON c.id = cs.card_id
     JOIN topic t ON t.id = c.topic_id
     JOIN course co ON co.id = t.course_id
     WHERE co.kind = 'vocab' AND c.type = 'word' AND cs.state != 0`
  )
  const learned = Number(l[0]?.n || 0)
  const score = reviews * REVIEW_WEIGHT + learned * LEARNED_WEIGHT
  const streak = await loadStreak().catch(() => 0)
  const peers = [...DEMO_PEERS, { name: '我', score, book: '本地学习', me: true }].sort((a, b) => b.score - a.score)
  return { score, learned, streak, peers }
}

export default function Rank() {
  const nav = useNavigate()
  const toast = useToast()
  const { data, loading, error, reload } = useAsync(loadRank, [])

  const [page, setPage] = useState(1)
  /** 仅驱动赛季倒计时刷新（不参与任何统计口径） */
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (error) toast.error('排行榜数据读取失败，可点击重试')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error])

  const peers = data?.peers ?? []
  const score = data?.score ?? 0
  const learned = data?.learned ?? 0
  const streak = data?.streak ?? 0

  const stageIdx = Math.max(0, Math.min(STAGES.length - 1, Math.floor(score / 800)))
  const stage = stageIdx + 1
  const stageInfo = STAGES[stageIdx]
  const nextStage = STAGES[stageIdx + 1] as { name: string; min: number } | undefined
  const toNext = nextStage ? Math.max(0, nextStage.min - score) : 0

  // 赛季倒计时（到本月结束后，与迁移前口径一致）
  const endOfMonth = new Date()
  endOfMonth.setMonth(endOfMonth.getMonth() + 1, 1)
  const left = endOfMonth.getTime() - Date.now()
  void tick // 每秒触发一次重渲染以刷新倒计时

  const pageCount = Math.max(1, Math.ceil(peers.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const pagePeers = peers.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const meIndex = peers.findIndex((p) => p.me)
  const me = meIndex >= 0 ? peers[meIndex] : undefined
  const meOnPage = pagePeers.some((p) => p.me)
  const mePage = Math.max(1, Math.ceil((meIndex + 1) / PAGE_SIZE))
  const top3 = peers.slice(0, 3)
  /** 领奖台顺序：左=第 2 名，中=第 1 名，右=第 3 名 */
  const podium = [top3[1], top3[0], top3[2]]

  const row = (p: Peer, rank: number) => (
    <div className={`rank-row${p.me ? ' is-me' : ''}`} key={`${p.name}-${rank}`} role="listitem">
      <span className="rank-no tnum" aria-label={ORDINAL[rank - 1] || `第 ${rank} 名`}>
        {rank}
      </span>
      <Avatar seed={p.name} name={`${p.name} 的头像`} size="md" />
      <div className="rank-main">
        <div className="rank-name truncate">
          {p.name}
          {p.me && (
            <Tag tone="brand" icon={<span aria-hidden>●</span>} title="这是我" className="rank-me-tag">
              我
            </Tag>
          )}
        </div>
        <div className="rank-book truncate">
          {p.me ? `本地学习 · 已学 ${formatNumber(learned)} · 连续 ${streak} 天` : p.book}
        </div>
      </div>
      <span className="rank-score tnum">{formatNumber(p.score)} 分</span>
    </div>
  )

  return (
    <div className="page-in">
      <PageHeader
        title="词书排行榜"
        kicker="RANK / SEASON"
        onBack={() => nav('/today')}
        crumbs={[{ label: '单词', to: '/today' }, { label: '学习排行榜' }]}
        onNavigate={(to) => nav(to)}
        actions={
          <IconButton label="刷新榜单" onClick={reload}>
            <RefreshCw size={17} />
          </IconButton>
        }
      />

      {loading && <LoadingState rows={3} title="正在计算赛季段位与榜单" />}

      {!loading && error && (
        <ErrorState
          title="排行榜数据读取失败"
          desc={`${error}（分数来自本机学习记录，恢复后重试即可）`}
          onRetry={reload}
        />
      )}

      {!loading && !error && data && (
        <>
          {/* 赛季横幅：星空/季赛氛围只保留为横幅内的渐变光晕（.rk-hero，见 polish.css），内放赛季信息与倒计时 */}
          <div className="rk-hero">
            <div className="rk-hero-stage">
              <div className="rk-hero-line">
                <Trophy size={14} aria-hidden />
                <span>
                  {stage} 段 · {stageInfo.name}
                  {nextStage ? ` · 距 ${nextStage.name} 还差 ${formatNumber(toNext)} 分` : ' · 已是最高段位'}
                </span>
              </div>
              <Progress
                value={score - stageInfo.min}
                max={nextStage ? nextStage.min - stageInfo.min : Math.max(1, score - stageInfo.min)}
                label={nextStage ? `距离 ${nextStage.name} 还差 ${formatNumber(toNext)} 分` : '已是最高段位'}
              />
            </div>
            <div className="rk-hero-timer">
              <span className="rk-hero-count tnum" aria-label={`赛季剩余 ${Math.floor(left / 86400000)} 天`}>
                还有 {formatCountdown(left)}结束
              </span>
              <span className="rk-hero-sub">赛季倒计时</span>
            </div>
          </div>

          {/* 段位星球：段位/解锁状态不只靠颜色，配数字、星名与「未解锁」文字 */}
          <div className="star-nav" role="list" aria-label={`赛季段位，当前 ${stage} 段 ${stageInfo.name}`}>
            {STAGES.map((s, i) => {
              const idx = i + 1
              const on = idx === stage
              const locked = idx > stage
              const label = `第 ${idx} 段 ${s.name}（${formatNumber(s.min)} 分起）`
              return (
                <span
                  key={s.name}
                  role="listitem"
                  className={`star${on ? ' is-on' : ''}${locked ? ' is-locked' : ''}`}
                  title={locked ? `${label} · 未解锁` : label}
                  aria-label={locked ? `${label}，未解锁` : on ? `${label}，当前段位` : label}
                >
                  {locked ? <Lock size={13} aria-hidden /> : idx}
                  <span className="sr-only">{locked ? `${s.name} 未解锁` : on ? `${s.name} 当前段位` : s.name}</span>
                </span>
              )
            })}
          </div>

          {/* 领奖台：名次用文字 + 奖牌图标标注，不只靠颜色 */}
          <div className="podium">
            {podium.map((p, i) => {
              if (!p) return null
              const place = i === 1 ? 1 : i === 0 ? 2 : 3
              return (
                <div className="podium-col" key={`${p.name}-${place}`}>
                  <Avatar seed={p.name} name={`${p.name} 的头像`} size="lg" />
                  <span className="podium-name" title={p.name}>
                    {p.name}
                  </span>
                  <span className="podium-score tnum">{formatNumber(p.score)} 分</span>
                  <div className={`podium-base is-${place}`} aria-label={ORDINAL[place - 1]}>
                    {place === 1 ? <Crown size={20} aria-hidden /> : <Medal size={17} aria-hidden />}
                    <span aria-hidden>{place}</span>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="row-meta" style={{ textAlign: 'center', padding: '0 var(--sp-4)' }}>
            {top3.length
              ? top3.map((p, i) => `${ORDINAL[i]} ${p.name}（${formatNumber(p.score)} 分）`).join(' · ')
              : '暂无榜单数据'}
          </p>

          {/* 榜单：超过 20 条时分页，避免一次性渲染全部 */}
          <div className="rank-list" role="list" aria-label="排行榜榜单">
            {pagePeers.map((p, i) => row(p, (current - 1) * PAGE_SIZE + i + 1))}
          </div>

          <Pagination
            page={current}
            pageCount={pageCount}
            total={peers.length}
            onChange={setPage}
            label="排行榜分页"
          />

          {me && !meOnPage && (
            <>
              <p className="row-meta" style={{ padding: '0 var(--sp-4)' }}>
                我的名次是第 {meIndex + 1} 名（第 {mePage} 页），已置底显示
              </p>
              <div className="rank-list" role="list" aria-label="我的名次">
                {row(me, meIndex + 1)}
              </div>
              <div style={{ padding: 'var(--sp-2) var(--sp-4)' }}>
                <Button variant="ghost" size="sm" icon={<FastForward size={14} />} onClick={() => setPage(mePage)}>
                  回到我所在的第 {mePage} 页
                </Button>
              </div>
            </>
          )}

          <div className="rank-note">
            <Info size={12} aria-hidden />
            <span>
              榜单同侪为本地演示数据，仅「我」的分数由真实学习记录计算（近 30 天复习 × {REVIEW_WEIGHT} + 已学词数 ×{' '}
              {LEARNED_WEIGHT}）
            </span>
          </div>
        </>
      )}
    </div>
  )
}
