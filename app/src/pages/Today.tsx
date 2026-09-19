import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDb } from '../db'
import { Play, Flame, Clock3, Layers } from 'lucide-react'

export default function Today() {
  const nav = useNavigate()
  const [s, setS] = useState<{ due: number; fresh: number; streak: number } | null>(null)

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
  const has = total > 0

  return (
    <div>
      <div className="page-title">今日</div>
      <div className="page-sub">
        {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
        {s && s.streak > 0 && (
          <span className="tag tag-amber" style={{ marginLeft: 10 }}>
            <Flame size={11} style={{ marginRight: 4 }} />
            连续 {s.streak} 天
          </span>
        )}
      </div>

      {has ? (
        <div className="card" style={{ padding: '28px 30px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div className="display-num">{total}</div>
              <div className="muted" style={{ marginTop: 2 }}>张卡片待学习</div>
            </div>
            <div style={{ width: 1, height: 44, background: 'var(--line)', alignSelf: 'center' }} />
            <div style={{ display: 'flex', gap: 22, color: 'var(--ink-2)', fontSize: 13 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Layers size={14} /> 复习 {s?.due || 0}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Clock3 size={14} /> 约 {minutes} 分钟
              </span>
            </div>
          </div>
          <div style={{ marginTop: 22 }}>
            <button className="btn btn-primary btn-lg" onClick={() => nav('/review')}>
              <Play size={15} /> 开始学习
            </button>
            <span className="muted" style={{ marginLeft: 14, fontSize: 12.5 }}>
              复习时按 <kbd>1</kbd>-<kbd>4</kbd> 打分，<kbd>空格</kbd> 显示答案
            </span>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: '30px 30px' }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>队列已清空</div>
          <div className="muted" style={{ margin: '5px 0 18px' }}>
            记忆需要间隔。明天再来，或现在去课程页生成新的知识点卡片。
          </div>
          <button className="btn btn-primary" onClick={() => nav('/courses')}>前往课程</button>
        </div>
      )}

      {has && (
        <div className="card card-flat" style={{ marginTop: 12, padding: '14px 18px', background: 'var(--paper-alt)' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
            为什么先回忆再看答案？主动回想比重读记得更牢——觉得「有点想不起来」正是记忆变强的时刻。
          </span>
        </div>
      )}
    </div>
  )
}
