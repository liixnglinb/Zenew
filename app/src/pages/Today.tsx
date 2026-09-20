import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDb, loadSession, localDayKey } from '../db'
import { daysUntil } from './Exams'
import { Play, Flame, Clock3, Layers, CalendarDays } from 'lucide-react'

export default function Today() {
  const nav = useNavigate()
  const [s, setS] = useState<{ due: number; fresh: number; streak: number } | null>(null)
  const [resume, setResume] = useState<{ idx: number; total: number } | null>(null)
  const [exam, setExam] = useState<{ title: string; days: number } | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const saved = await loadSession()
        if (saved) setResume({ idx: saved.idx, total: saved.card_ids.length })
      } catch {}
      try {
        const db = await getDb()
        const rows = await db.select<{ title: string; exam_date: string }[]>(
          'SELECT title, exam_date FROM exam WHERE exam_date >= ? ORDER BY exam_date ASC LIMIT 1',
          [localDayKey()]
        )
        if (rows.length) setExam({ title: rows[0].title, days: daysUntil(rows[0].exam_date) })
      } catch {}
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
        // UTC 日 → 本地日（东八区 00:00-08:00 学习不再错位到昨天）
        const daySet = new Set(days.map((r) => localDayKey(r.d + 'T00:00:00Z')))
        const cur = new Date()
        // 今天没学不立刻清零：从昨天起算（宽限一天，避免早上打开看到 0 天挫败）
        if (!daySet.has(localDayKey(cur))) cur.setDate(cur.getDate() - 1)
        for (;;) {
          const key = localDayKey(cur)
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

  if (!s) {
    return (
      <div className="page-in">
        <div className="kicker">TODAY / {new Date().toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</div>
        <div className="page-title">今日</div>
        <div className="card" style={{ padding: '30px 32px', marginTop: 22 }}>
          <div className="skeleton sk-line" style={{ width: 120, height: 44 }} />
          <div className="skeleton sk-line" style={{ width: 200, marginTop: 16 }} />
        </div>
      </div>
    )
  }

  return (
    <div className="page-in">
      <div className="kicker">TODAY / {new Date().toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="page-title">今日</div>
        {s && s.streak > 0 && (
          <span className="streak-pill fade-up">
            <Flame size={12} /> {s.streak} 天
          </span>
        )}
        {exam && (
          <span className={`streak-pill fade-up${exam.days <= 7 ? ' is-urgent' : ''}`} title={`最近考试：${exam.title}`} onClick={() => nav('/exams')} style={{ cursor: 'pointer' }}>
            <CalendarDays size={12} /> {exam.days === 0 ? '今天考试' : `${exam.title} ${exam.days} 天后`}
          </span>
        )}
      </div>

      {has ? (
        <>
          <div className="card" style={{ padding: '30px 32px', marginTop: 22 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 22, flexWrap: 'wrap' }}>
              <div>
                <div className="display-num">{total}</div>
                <div className="muted" style={{ marginTop: 4, fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: 1 }}>张卡片待学习</div>
              </div>
              <div style={{ width: 1, height: 46, background: 'var(--line)', alignSelf: 'center' }} />
              <div style={{ display: 'flex', gap: 20, color: 'var(--ink-2)', fontSize: 13 }}>
                <span className="tag"><Layers size={11} /> 复习 {s?.due || 0}</span>
                <span className="tag"><Clock3 size={11} /> 约 {minutes} 分钟</span>
              </div>
            </div>
            <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 14 }}>
              <button className="btn btn-primary btn-lg" onClick={() => nav('/review')}>
                <Play size={15} /> {resume ? '继续学习' : '开始学习'}
              </button>
              <span className="muted" style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>
                {resume
                  ? `上次学到第 ${resume.idx + 1} / ${resume.total} 张，接着上次继续`
                  : <span><kbd>1</kbd>-<kbd>4</kbd> 打分 · <kbd>空格</kbd> 翻面</span>}
              </span>
            </div>
          </div>
          <div className="today-hint fade-up">
            <span className="dot" />
            主动回忆 · 先想再看答案
          </div>
        </>
      ) : (
        <div className="card" style={{ padding: '30px 32px', marginTop: 22, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: 34, top: '50%', transform: 'translateY(-50%)', width: 104, height: 104, borderRadius: '50%', border: '1px solid var(--gold-line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--gold-wash)' }} />
          </div>
          <div className="display-num" style={{ color: 'var(--ink-3)' }}>0</div>
          <div className="muted" style={{ margin: '8px 0 20px', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: 1 }}>队列已清空</div>
          <button className="btn btn-primary" onClick={() => nav('/courses')}>前往课程</button>
        </div>
      )}
    </div>
  )
}
