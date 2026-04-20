import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Course } from '../types'

interface Props {
  selected: Course | null
  onSelect: (c: Course) => void
}

export function Sidebar({ selected, onSelect }: Props) {
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

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

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[var(--border)]">
        <p className="font-mono text-xs text-[var(--text-muted)]">
          {courses.length} courses indexed
        </p>
      </div>
    </aside>
  )
}
