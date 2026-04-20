import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Course } from '../types'

interface BatchItem {
  video_id: string
  title: string
  status: string
  error?: string
}

interface Props {
  selected: Course | null
  onSelect: (c: Course) => void
  batchTaskId: string | null
  batchItems: BatchItem[]
  batchDone: number
  batchTotal: number
  batchCurrent: string
}

export function Sidebar({ selected, onSelect, batchTaskId, batchItems, batchDone, batchTotal, batchCurrent }: Props) {
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [batchExpanded, setBatchExpanded] = useState(true)

  useEffect(() => {
    api.courses()
      .then(setCourses)
      .catch(() => setCourses([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = courses.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase()) ||
    c.course_code?.toLowerCase().includes(query.toLowerCase())
  )

  const isBatchActive = batchTaskId !== null

  return (
    <aside className="flex flex-col w-64 shrink-0 h-screen border-r border-[var(--border)] bg-[var(--surface)]">

      {/* Header */}
      <div className="px-5 pt-6 pb-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-amber font-mono text-lg">◈</span>
          <span className="font-mono font-bold text-amber tracking-widest text-sm">CANVAS2NOTE</span>
        </div>
        <p className="text-[var(--text-muted)] font-mono text-xs">research terminal v0.1</p>
      </div>

      {/* Search */}
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] font-mono text-xs">›</span>
          <input
            type="text"
            placeholder="filter courses..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 pl-6 py-1.5 font-mono text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-amber/50"
          />
        </div>
      </div>

      {/* Course list */}
      <div className="flex-1 overflow-y-auto py-2">
        {loading && (
          <div className="px-5 py-4 font-mono text-xs text-[var(--text-muted)] animate-pulse">
            loading courses<span className="cursor" />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="px-5 py-4 font-mono text-xs text-[var(--text-muted)]">no courses found</div>
        )}
        {filtered.map((c, i) => {
          const active = selected?.id === c.id
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              className={`w-full text-left px-4 py-3 group transition-all duration-150 border-l-2 ${
                active
                  ? 'border-amber bg-[var(--surface2)] text-amber'
                  : 'border-transparent hover:border-[var(--amber-dim)] hover:bg-[var(--surface2)] text-[var(--text)]'
              }`}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div className="flex items-start gap-2">
                <span className={`font-mono text-xs mt-0.5 shrink-0 ${active ? 'text-amber' : 'text-[var(--text-muted)]'}`}>
                  [{String(i + 1).padStart(2, '0')}]
                </span>
                <div className="min-w-0">
                  <p className="text-sm leading-tight truncate font-medium">{c.name}</p>
                  {c.course_code && (
                    <p className="font-mono text-xs text-[var(--text-muted)] mt-0.5 truncate">{c.course_code}</p>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Batch progress panel */}
      {isBatchActive && (
        <div className="border-t border-[var(--border)] bg-[var(--surface2)]">
          <button
            onClick={() => setBatchExpanded(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2 hover:bg-[var(--surface)] transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-amber font-mono text-xs animate-pulse">◎</span>
              <span className="font-mono text-xs text-[var(--text)]">
                批量任务
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-amber">
                {batchDone}/{batchTotal}
              </span>
              <span className="font-mono text-xs text-[var(--text-muted)]">
                {batchExpanded ? '▲' : '▼'}
              </span>
            </div>
          </button>

          {/* Progress bar */}
          <div className="px-4 pb-1">
            <div className="h-1 bg-[var(--border)] rounded-full overflow-hidden">
              <div
                className="h-full bg-amber rounded-full transition-all duration-500"
                style={{ width: `${batchTotal > 0 ? (batchDone / batchTotal * 100) : 0}%` }}
              />
            </div>
          </div>

          {/* Item list */}
          {batchExpanded && (
            <div className="overflow-y-auto" style={{ maxHeight: '200px' }}>
              {batchItems.map(item => (
                <div
                  key={item.video_id}
                  className="flex items-center gap-2 px-4 py-1.5 border-t border-[var(--border)]/50"
                >
                  <span className="font-mono text-xs shrink-0 w-4 text-center">
                    {item.status === 'done' ? '✓' :
                     item.status === 'error' ? '✗' :
                     item.status === 'transcribing' ? '◎' :
                     item.status === 'downloading' ? '↓' : '…'}
                  </span>
                  <span className={`font-mono text-xs truncate flex-1 min-w-0 ${
                    item.status === 'done' ? 'text-sage' :
                    item.status === 'error' ? 'text-rust' :
                    item.title === batchCurrent ? 'text-amber' :
                    'text-[var(--text-muted)]'
                  }`}>
                    {item.title || item.video_id}
                  </span>
                </div>
              ))}
              {batchCurrent && (
                <div className="flex items-center gap-2 px-4 py-1.5 border-t border-[var(--border)]/50">
                  <span className="font-mono text-xs text-amber animate-pulse">→</span>
                  <span className="font-mono text-xs text-amber truncate">{batchCurrent}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[var(--border)]">
        <p className="font-mono text-xs text-[var(--text-muted)]">
          {courses.length} courses indexed
        </p>
      </div>
    </aside>
  )
}
