import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { api } from '../api'
import { Icons } from './icons'
import { Progress } from './ui/Progress'
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
  onClose: () => void
  batchTaskId: string | null
  batchItems: BatchItem[]
  batchDone: number
  batchTotal: number
  batchCurrent: string
}

export function Sidebar({ selected, onSelect, onClose, batchTaskId, batchItems, batchDone, batchTotal, batchCurrent }: Props) {
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
    <aside className="flex flex-col w-64 h-screen border-r border-border bg-surface">
      {/* Header */}
      <div className="px-5 pt-6 pb-4 border-b border-border">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2.5">
            <Icons.Sparkles size={18} className="text-accent" strokeWidth={1.5} />
            <span className="font-mono font-semibold text-text tracking-[0.15em] text-sm uppercase">Canvas2Note</span>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1 rounded-lg text-muted hover:text-text hover:bg-surface2 transition-colors"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <p className="text-muted font-mono text-xs tracking-wide">v1.0.0 · 录屏 · 转录 · 笔记</p>
      </div>

      {/* Search */}
      <div className="px-4 py-3 border-b border-border">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-accent" strokeWidth={1.5} />
          <input
            type="text"
            placeholder="filter courses..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-bg border border-border rounded-lg px-2 pl-7 py-1.5 font-mono text-xs text-text placeholder:text-faint focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-bg transition-all"
          />
        </div>
      </div>

      {/* Course list */}
      <div className="flex-1 overflow-y-auto py-2">
        {loading && (
          <div className="px-5 py-4 font-mono text-xs text-muted animate-pulse">
            loading courses<span className="cursor" />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="px-5 py-4 font-mono text-xs text-muted">no courses found</div>
        )}
        {filtered.map((c, i) => {
          const active = selected?.id === c.id
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              className={`w-full text-left px-4 py-3 group transition-all duration-150 border-l-[3px] ${
                active
                  ? 'border-brand bg-brand-bg text-brand'
                  : 'border-transparent hover:border-border2 hover:bg-surface2 text-text'
              }`}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div className="flex items-start gap-2.5">
                <span className={`font-mono text-xs mt-0.5 shrink-0 w-5 ${active ? 'text-brand' : 'text-faint'}`}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <p className="text-sm leading-tight truncate font-medium">{c.name}</p>
                  {c.course_code && (
                    <p className="font-mono text-xs text-muted mt-0.5 truncate">{c.course_code}</p>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Batch progress panel */}
      {isBatchActive && (
        <div className="border-t border-border bg-surface2">
          <button
            onClick={() => setBatchExpanded(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface transition-colors"
          >
            <div className="flex items-center gap-2">
              <Icons.Mic size={12} className="text-brand animate-pulse" strokeWidth={1.5} />
              <span className="font-mono text-xs text-text-mid">
                批量任务
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-brand font-medium">
                {batchDone}/{batchTotal}
              </span>
              <span className="font-mono text-xs text-muted">
                {batchExpanded ? <Icons.ChevronUp size={10} /> : <Icons.ChevronDown size={10} />}
              </span>
            </div>
          </button>

          <div className="px-4 pb-1">
            <Progress value={batchTotal > 0 ? (batchDone / batchTotal * 100) : 0} />
          </div>

          {batchExpanded && (
            <div className="overflow-y-auto" style={{ maxHeight: '200px' }}>
              {batchItems.map(item => (
                <div
                  key={item.video_id}
                  className="flex items-center gap-2 px-4 py-1.5 border-t border-border/50"
                >
                  <span className="font-mono text-xs shrink-0 w-4 text-center">
                    {item.status === 'done' ? <Icons.Check size={10} className="text-success" /> :
                     item.status === 'error' ? <Icons.X size={10} className="text-error" /> :
                     item.status === 'transcribing' ? <Icons.Mic size={10} className="text-accent" /> :
                     item.status === 'downloading' ? <Icons.Download size={10} className="text-brand" /> :
                     <Icons.Loader2 size={10} className="animate-spin" />}
                  </span>
                  <span className={`font-mono text-xs truncate flex-1 min-w-0 ${
                    item.status === 'done' ? 'text-accent' :
                    item.status === 'error' ? 'text-error' :
                    item.title === batchCurrent ? 'text-brand' :
                    'text-muted'
                  }`}>
                    {item.title || item.video_id}
                  </span>
                </div>
              ))}
              {batchCurrent && (
                <div className="flex items-center gap-2 px-4 py-1.5 border-t border-border/50">
                  <Icons.ChevronRight size={10} className="text-brand animate-pulse shrink-0" />
                  <span className="font-mono text-xs text-brand truncate">{batchCurrent}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border">
        <p className="font-mono text-xs text-faint">
          {courses.length} courses indexed
        </p>
      </div>
    </aside>
  )
}
