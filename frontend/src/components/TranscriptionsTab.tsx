import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Course, Transcription } from '../types'

function detectLang(text: string): string {
  const cjk = (text.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) ?? []).length
  const latin = (text.match(/[a-zA-Z]/g) ?? []).length
  const de = /\b(und|der|die|das|ist|mit|von|für|nicht)\b/.test(text)
  if (cjk / (text.length + 1) > 0.15) return '中文/日本語'
  if (de) return 'Deutsch'
  return 'EN'
}

export function TranscriptionsTab({ course, refresh }: { course: Course; refresh: number }) {
  const [list, setList] = useState<Transcription[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.transcriptions().then(all => {
      const safeCourse = (s: string) => s.replace(/[^\w\u4e00-\u9fff ._-]/g, '_').trim()
      setList(all.filter((t: Transcription) => safeCourse(t.course) === safeCourse(course.name)))
    }).catch(() => setList([]))
  }, [refresh, course.id])

  async function load(name: string) {
    setSelected(name)
    setLoading(true)
    const r = await api.transcription(name).catch(() => null)
    setText(r?.text ?? '')
    setLoading(false)
  }

  return (
    <div className="h-full flex">
      {/* Left: list */}
      <div className="w-64 shrink-0 border-r border-[var(--border)] overflow-y-auto">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <p className="font-mono text-xs text-[var(--text-muted)]">{list.length} transcriptions</p>
        </div>
        {list.length === 0 && (
          <p className="px-4 py-6 font-mono text-xs text-[var(--text-muted)]">
            no transcriptions yet — transcribe a video first
          </p>
        )}
        {list.map(t => (
          <button
            key={t.name}
            onClick={() => load(t.name)}
            className={`w-full text-left px-4 py-3 border-b border-[var(--border)]/50 transition-colors ${
              selected === t.name
                ? 'bg-[var(--surface2)] border-l-2 border-l-sage text-sage'
                : 'hover:bg-[var(--surface2)] text-[var(--text)]'
            }`}
          >
            <p className="font-mono text-xs truncate">{t.name}</p>
            <p className="font-mono text-xs text-[var(--text-muted)] mt-0.5">
              {(t.size / 1024).toFixed(1)} KB
            </p>
          </button>
        ))}
      </div>

      {/* Right: content */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected && (
          <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
            <div className="text-center">
              <span className="text-5xl block mb-3 opacity-20">◎</span>
              <p className="font-mono text-sm">select a transcription</p>
            </div>
          </div>
        )}
        {selected && (
          <>
            <div className="px-6 py-3 border-b border-[var(--border)] flex items-center gap-3">
              <span className="font-mono text-sm text-sage">{selected}</span>
              {text && (
                <span className="font-mono text-xs px-2 py-0.5 bg-sage/10 text-sage rounded border border-sage/20">
                  {detectLang(text)}
                </span>
              )}
              <span className="ml-auto font-mono text-xs text-[var(--text-muted)]">
                {text.split(/\s+/).length} words
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {loading ? (
                <div className="font-mono text-xs text-[var(--text-muted)] animate-pulse">loading<span className="cursor" /></div>
              ) : (
                <p className="font-mono text-sm text-[var(--text)] leading-relaxed whitespace-pre-wrap">{text}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
