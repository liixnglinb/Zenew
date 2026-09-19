import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDb } from '../db'
import { Play } from 'lucide-react'

interface Summary {
  due: number
  fresh: number
  streak: number
}

export default function Today() {
  const nav = useNavigate()
  const [s, setS] = useState<Summary | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const db = await getDb()
        const now = new Date().toISOString()
        const dueRows = await db.select<unknown[]>(
          'SELECT cs.card_id FROM card_state cs JOIN card c ON c.id=cs.card_id WHERE c.suspended=0 AND cs.due<=? AND cs.state!=0',
          [now]
        )
        const freshRows = await db.select<unknown[]>('SELECT c.id FROM card c LEFT JOIN card_state cs ON cs.card_id=c.id WHERE c.suspended=0 AND cs.card_id IS NULL LIMIT 25')
        const days = await db.select<{ d: string }[]>("SELECT DISTINCT substr(reviewed_at,1,10) AS d FROM review_log ORDER BY d DESC LIMIT 60")
        let streak = 0
        const daySet = new Set(days.map((r) => r.d))
        const cur = new Date()
        for (;;) {
          const key = cur.toISOString().slice(0, 10)
          if (daySet.has(key)) {
            streak++
            cur.setDate(cur.getDate() - 1)
          } else break
        }
        setS({ due: dueRows.length, fresh: Math.min(freshRows.length, 10), streak })
      } catch (e) {
        console.error(e)
        setS({ due: 0, fresh: 0, streak: 0 })
      }
    })()
  }, [])

  const total = (s?.due || 0) + (s?.fresh || 0)
  const minutes = Math.max(1, Math.round((total * 25) / 60))

  return (
    <div>
      <div className="page-title">今日</div>
      <div className="page-sub">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</div>

      <div className="card" style={{ padding: 28 }}>
        {total === 0 ? (
          <div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>当前没有待复习的卡片</div>
            <div className="muted" style={{ margin: '6px 0 16px' }}>去课程页选择知识点，生成卡片后开始学习。</div>
            <button className="btn btn-primary" onClick={() => nav('/courses')}>
              前往课程
            </button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 34, fontWeight: 700 }}>
              {total} <span style={{ fontSize: 15, fontWeight: 400, color: 'var(--ink-soft)' }}>张卡片待学习</span>
            </div>
            <div className="muted" style={{ margin: '6px 0 18px' }}>
              复习 {s?.due || 0} 张 · 新学 {s?.fresh || 0} 张 · 预计 {minutes} 分钟
              {s && s.streak > 0 && ` · 已连续 ${s.streak} 天`}
            </div>
            <button className="btn btn-accent btn-lg" onClick={() => nav('/review')}>
              <Play size={16} /> 开始学习
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>为什么是"先回忆，再看答案"？</div>
        <div className="muted">
          提取练习（主动回忆）比重复阅读记得更牢——这是学习科学中证据最强的结论之一。觉得"有点想不起来"恰恰是记忆变强的时刻。
        </div>
      </div>
    </div>
  )
}
