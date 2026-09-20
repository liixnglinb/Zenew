import { useEffect, useState } from 'react'
import { getDb, localDayKey } from '../db'
import { fetchMe, type Me } from '../api'

interface Stats {
  courses: number
  topics: number
  cards: number
  mastered: number
  reviewing: number
  todayReviews: number
  week: { day: string; n: number }[]
}

export default function Stats() {
  const [s, setS] = useState<Stats | null>(null)
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    ;(async () => {
      const db = await getDb()
      const courses = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM course')
      const topics = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM topic WHERE parent_id IS NOT NULL')
      const cards = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM card')
      const mastered = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM card_state WHERE state=2 AND stability>=21')
      const reviewing = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM card_state WHERE state=2 AND stability<21')
      const learning = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM card_state WHERE state IN (1,3)')
      const logs = await db.select<{ reviewed_at: string; rating: number }[]>(
        'SELECT reviewed_at, rating FROM review_log WHERE reviewed_at >= ?',
        [new Date(Date.now() - 7 * 86400000).toISOString()]
      )
      // 本地时区分桶（UTC 存库会在东八区早上 8 点前错位到昨天）
      const byDay = new Map<string, number>()
      for (const l of logs) {
        const k = localDayKey(l.reviewed_at)
        byDay.set(k, (byDay.get(k) || 0) + 1)
      }
      const todayKey = localDayKey()
      const week: { day: string; n: number }[] = []
      for (let i = 6; i >= 0; i--) {
        const dt = new Date(Date.now() - i * 86400000)
        const key = localDayKey(dt)
        week.push({ day: key.slice(5), n: byDay.get(key) || 0 })
      }
      setS({
        courses: courses[0]?.n || 0,
        topics: topics[0]?.n || 0,
        cards: cards[0]?.n || 0,
        mastered: mastered[0]?.n || 0,
        reviewing: (reviewing[0]?.n || 0) + (learning[0]?.n || 0),
        todayReviews: byDay.get(todayKey) || 0,
        week,
      })
      try {
        setMe(await fetchMe())
      } catch {
        /* 离线静默 */
      }
    })().catch(console.error)
  }, [])

  if (!s) {
    return (
      <div className="page-in">
        <div className="kicker">STATS / RETENTION</div>
        <div className="page-title">统计</div>
        <div className="metric-row" style={{ marginTop: 24 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="metric">
              <div className="skeleton sk-line" style={{ width: 54, height: 26 }} />
              <div className="skeleton sk-line" style={{ width: 36, height: 10, marginTop: 8 }} />
            </div>
          ))}
        </div>
        <div className="card"><div className="skeleton sk-card" style={{ height: 160 }} /></div>
      </div>
    )
  }
  const maxWeek = Math.max(1, ...s.week.map((w) => w.n))
  const quota = me?.quota_tokens || 0
  const pct = quota > 0 ? Math.min(100, ((me?.used_tokens || 0) / quota) * 100) : 0

  return (
    <div className="page-in">
      <div className="kicker">STATS / RETENTION</div>
      <div className="page-title">统计</div>

      <div className="metric-row" style={{ marginTop: 24 }}>
        <div className="metric"><b>{s.todayReviews}</b><span>今日</span></div>
        <div className={`metric${s.mastered > 0 ? ' metric-hl' : ''}`}><b>{s.mastered}</b><span>已掌握</span></div>
        <div className="metric"><b>{s.reviewing}</b><span>巩固中</span></div>
        <div className="metric"><b>{s.cards}</b><span>卡片</span></div>
      </div>
      <div className="muted" style={{ fontFamily: 'var(--mono)', fontSize: 11, marginBottom: 22 }}>
        {s.courses} 门课程 · {s.topics} 个知识点 · 掌握 = 稳定期 ≥ 21 天
      </div>
      <div className="card">
        <div className="section-label">LAST 7 DAYS</div>
        <div className="chart-values">
          {s.week.map((w) => (
            <span key={w.day} style={{ visibility: w.n > 0 ? 'visible' : 'hidden' }}>{w.n}</span>
          ))}
        </div>
        <div className="chart">
          {s.week.map((w) => (
            <div key={w.day} className={`chart-col${w.n === 0 ? ' zero' : ''}`}>
              <i style={w.n > 0 ? { height: `${Math.max(4, (w.n / maxWeek) * 100)}%` } : undefined} />
            </div>
          ))}
        </div>
        <div className="chart-labels">
          {s.week.map((w) => (
            <span key={w.day}>{w.day}</span>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="section-label">QUOTA</div>
        {me ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="muted" style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                {me.used_tokens.toLocaleString()} / {me.quota_tokens.toLocaleString()}
              </span>
              <span className="tag tag-mono tag-gold">{pct.toFixed(1)}%</span>
            </div>
            <div className="bar" style={{ height: 5 }}>
              {pct > 0 && <span className="seg-gold" style={{ width: `${pct}%` }} />}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
              <span className="muted" style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>充值余额</span>
              <span className="stat-value" style={{ fontSize: 13, fontWeight: 600 }}>
                {((me.balance_tokens || 0) / 10000).toFixed(0)} 万 tokens
              </span>
            </div>
          </>
        ) : (
          <div className="muted">离线中</div>
        )}
      </div>
    </div>
  )
}
