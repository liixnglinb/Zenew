import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDb, loadQueue, nowIso, type QueueItem } from '../db'
import { schedule, R } from '../fsrs'

type Phase = 'front' | 'answered'

export default function ReviewSession() {
  const nav = useNavigate()
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('front')
  const [picked, setPicked] = useState<number | null>(null)
  const [done, setDone] = useState<{ total: number; again: number; ms: number } | null>(null)
  const shownAt = useRef<number>(Date.now())
  const sessionStart = useRef<number>(Date.now())
  const againCount = useRef<number>(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const newLimit = Number(localStorage.getItem('zenew_new_limit') || '10') || 10
      const q = await loadQueue(nowIso(), newLimit)
      setQueue(q)
      setLoading(false)
      shownAt.current = Date.now()
    })()
  }, [])

  if (loading) return <div className="muted">载入中…</div>

  if (done || queue.length === 0) {
    const s = done || { total: 0, again: 0, ms: 0 }
    return (
      <div className="review-stage">
        <div className="page-title">{queue.length === 0 && !done ? '没有待学习的卡片' : '本次学习完成'}</div>
        {done && (
          <div className="card" style={{ marginTop: 12 }}>
            <div style={{ fontSize: 17 }}>
              共 {s.total} 张 · 标记"忘了" {s.again} 张 · 用时 {Math.round(s.ms / 1000)} 秒
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              标记"忘了"不是失败——这正是调度器判断"什么时候该再见到你"的依据。
            </div>
          </div>
        )}
        {queue.length === 0 && !done && <div className="muted">先去课程页生成一些卡片吧。</div>}
        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={() => nav('/today')}>
            回到今日
          </button>
          <button className="btn" onClick={() => nav('/courses')}>
            继续生成卡片
          </button>
        </div>
      </div>
    )
  }

  const item = queue[idx]
  const choices: string[] | null = item.choices_json ? JSON.parse(item.choices_json) : null

  const commit = async (grade: number) => {
    const db = await getDb()
    const { next } = schedule(item.st, grade as 1 | 2 | 3 | 4)
    const row = { ...next, card_id: item.id }
    await db.execute(
      `INSERT INTO card_state(card_id,due,stability,difficulty,elapsed_days,scheduled_days,reps,lapses,state,last_review)
       VALUES(?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(card_id) DO UPDATE SET due=excluded.due, stability=excluded.stability, difficulty=excluded.difficulty,
         elapsed_days=excluded.elapsed_days, scheduled_days=excluded.scheduled_days, reps=excluded.reps,
         lapses=excluded.lapses, state=excluded.state, last_review=excluded.last_review`,
      [row.card_id, row.due, row.stability, row.difficulty, row.elapsed_days, row.scheduled_days, row.reps, row.lapses, row.state, row.last_review]
    )
    await db.execute('INSERT INTO review_log(card_id,rating,reviewed_at,duration_ms) VALUES(?,?,?,?)', [
      item.id,
      grade,
      nowIso(),
      Date.now() - shownAt.current,
    ])
  }

  const advance = () => {
    if (idx + 1 >= queue.length) {
      setDone({ total: queue.length, again: againCount.current, ms: Date.now() - sessionStart.current })
    } else {
      setIdx(idx + 1)
      setPhase('front')
      setPicked(null)
      shownAt.current = Date.now()
    }
  }

  const pickChoice = (i: number) => {
    if (phase === 'answered') return
    setPicked(i)
    setPhase('answered')
    void commit(i === (item.answer_index ?? 0) ? R.Good : R.Again)
    if (i !== (item.answer_index ?? 0)) againCount.current++
  }

  const selfGrade = (g: 1 | 2 | 3 | 4) => {
    void commit(g)
    if (g === R.Again) againCount.current++
    advance()
  }

  const answeredRight = picked !== null && picked === (item.answer_index ?? 0)

  return (
    <div className="review-stage">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span className="tag">
          {idx + 1} / {queue.length}
        </span>
        <span className="muted">
          {item.course_name} · {item.topic_title}
        </span>
      </div>

      <div className="card" style={{ padding: 28 }}>
        <div className="tag tag-accent">{item.type === 'basic' ? '回忆' : item.type === 'why' ? '解释' : '选择'}</div>
        <div className="review-front">{item.front}</div>

        {choices && phase === 'front' && (
          <div style={{ marginTop: 10 }}>
            {choices.map((c, i) => (
              <button key={i} className="choice-btn" onClick={() => pickChoice(i)}>
                {String.fromCharCode(65 + i)}. {c}
              </button>
            ))}
          </div>
        )}

        {choices && phase === 'answered' && (
          <div style={{ marginTop: 10 }}>
            {choices.map((c, i) => (
              <button key={i} className={`choice-btn ${i === (item.answer_index ?? 0) ? 'right' : ''} ${i === picked && !answeredRight ? 'wrong' : ''}`} style={{ cursor: 'default' }}>
                {String.fromCharCode(65 + i)}. {c}
              </button>
            ))}
          </div>
        )}

        {!choices && phase === 'front' && (
          <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setPhase('answered')}>
            先回忆，再看答案
          </button>
        )}

        {phase === 'answered' && (
          <div>
            <div className="review-back">
              <span className="muted">答案：</span>
              {item.back}
            </div>
            <div className="explain-box">
              <b>为什么：</b>
              {item.explanation}
            </div>
            {choices ? (
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={advance}>
                {idx + 1 >= queue.length ? '完成' : '下一张'}
              </button>
            ) : (
              <div className="grade-row">
                <button className="btn g-again" onClick={() => selfGrade(1)}>
                  忘了<small>完全想不起来</small>
                </button>
                <button className="btn g-hard" onClick={() => selfGrade(2)}>
                  想起来了<small>但很费劲</small>
                </button>
                <button className="btn g-good" onClick={() => selfGrade(3)}>
                  记得<small>想了一会儿</small>
                </button>
                <button className="btn g-easy" onClick={() => selfGrade(4)}>
                  秒答<small>非常确定</small>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
