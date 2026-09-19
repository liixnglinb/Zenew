import { useEffect, useState } from 'react'
import { getDb } from '../db'
import { fetchMe, type Me } from '../api'

interface Stats {
  courses: number
  topics: number
  cards: number
  mastered: number
  reviewing: number
  newCards: number
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
      const today = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM review_log WHERE substr(reviewed_at,1,10)=substr(?,1,10)", [new Date().toISOString()])
      const weekRows = await db.select<{ d: string; n: number }[]>(
        "SELECT substr(reviewed_at,1,10) AS d, COUNT(*) AS n FROM review_log WHERE reviewed_at >= ? GROUP BY d ORDER BY d",
        [new Date(Date.now() - 6 * 86400000).toISOString()]
      )
      const week: { day: string; n: number }[] = []
      for (let i = 6; i >= 0; i--) {
        const key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
        week.push({ day: key.slice(5), n: weekRows.find((r) => r.d === key)?.n || 0 })
      }
      setS({
        courses: courses[0]?.n || 0,
        topics: topics[0]?.n || 0,
        cards: cards[0]?.n || 0,
        mastered: mastered[0]?.n || 0,
        reviewing: (reviewing[0]?.n || 0) + (learning[0]?.n || 0),
        newCards: cards[0]?.n || 0,
        todayReviews: today[0]?.n || 0,
        week,
      })
      try {
        setMe(await fetchMe())
      } catch {
        /* 离线时静默 */
      }
    })().catch(console.error)
  }, [])

  if (!s) return <div className="muted">载入中…</div>
  const maxWeek = Math.max(1, ...s.week.map((w) => w.n))

  return (
    <div>
      <div className="page-title">统计</div>
      <div className="page-sub">看"记住了多少"，而不是"学了多久"</div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        {[
          { label: '课程', v: s.courses },
          { label: '知识点', v: s.topics },
          { label: '卡片', v: s.cards },
          { label: '已掌握', v: s.mastered },
          { label: '巩固中', v: s.reviewing },
          { label: '今日已复习', v: s.todayReviews },
        ].map((x) => (
          <div key={x.label} className="card" style={{ flex: 1, minWidth: 120, textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{x.v}</div>
            <div className="muted">{x.label}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 12 }}>近 7 天复习量</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 120 }}>
          {s.week.map((w) => (
            <div key={w.day} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ background: 'var(--primary)', borderRadius: 4, height: `${(w.n / maxWeek) * 90 + 4}px`, marginBottom: 6 }} />
              <div className="muted" style={{ fontSize: 11 }}>
                {w.day}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{w.n}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>生成额度</div>
        {me ? (
          <div>
            <div className="muted" style={{ marginBottom: 8 }}>
              本月已用 {me.used_tokens} / {me.quota_tokens} tokens
            </div>
            <div className="bar">
              <span className="seg-accent" style={{ width: `${Math.min(100, (me.used_tokens / me.quota_tokens) * 100)}%` }} />
            </div>
          </div>
        ) : (
          <div className="muted">离线中，无法获取云端额度。</div>
        )}
      </div>
    </div>
  )
}
