// 词书专学页：/vocab/:key → 只出该词书的队列，进入同一 FSRS 复习循环
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { loadQueueByCourse, nowIso, type QueueItem } from '../db'
import ReviewSession from './ReviewSession'

const BOOK_NAMES: Record<string, string> = {
  cet4: '英语四级',
  cet6: '英语六级',
  freq: '高频词',
  basic: '基础英语',
  notebook: '生词本',
}

export default function VocabStudy() {
  const { key = '' } = useParams()
  const nav = useNavigate()
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const name = BOOK_NAMES[key] || ''

  useEffect(() => {
    if (!name) {
      nav('/vocab')
      return
    }
    void (async () => {
      const q = await loadQueueByCourse(name, nowIso(), 10)
      setQueue(q)
      setLoading(false)
      if (!q.length) {
        // 该书无可学卡（全部学完或未导入）→ 回词书页
        nav('/vocab')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (loading || !queue.length) return <div className="muted">···</div>
  return <ReviewSession initialQueue={queue} />
}
