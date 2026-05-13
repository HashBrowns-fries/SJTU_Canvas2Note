import { useEffect, useState } from 'react'
import { Mic } from 'lucide-react'
import { api } from '../api'
import { Badge } from './ui/Badge'
import { Skeleton } from './ui/Skeleton'
import { EmptyState } from './ui/EmptyState'
import type { Course, Transcription } from '../types'

function detectLang(text: string): string {
  const cjk = (text.match(/[぀-ヿ一-鿿]/g) ?? []).length
  const latin = (text.match(/[a-zA-Z]/g) ?? []).length
  const de = /\b(und|der|die|das|ist|mit|von|für|nicht)\b/.test(text)
  if (cjk / (text.length + 1) > 0.15) return '中文/日本語'
  if (de) return 'Deutsch'
  return 'EN'
}

interface Props { course: Course; refresh: number }

export function TranscriptionsTab({ course, refresh }: Props) {
  const [list, setList] = useState<Transcription[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.transcriptions().then(all => {
      const norm = (s: string) => s.replace(/[（()].*/, '').trim()
      setList(all.filter((t: Transcription) => norm(t.course) === norm(course.name)))
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
      <div className="w-56 sm:w-64 shrink-0 border-r border-border overflow-y-auto">
        <div className="px-4 py-3 border-b border-border">
          <p className="font-mono text-xs text-muted">{list.length} transcriptions</p>
        </div>
        {list.length === 0 && (
          <p className="px-4 py-6 font-mono text-xs text-muted">
            No transcriptions yet — transcribe a video first
          </p>
        )}
        {list.map(t => (
          <button
            key={t.name}
            onClick={() => load(t.name)}
            className={`w-full text-left px-4 py-3 border-b border-border/50 transition-colors ${
              selected === t.name
                ? 'bg-surface2 border-l-2 border-l-accent text-accent'
                : 'hover:bg-surface2 text-text'
            }`}
          >
            <p className="font-mono text-xs truncate">{t.name.split('/').pop() || t.name}</p>
            <p className="font-mono text-xs text-muted mt-0.5">{(t.size / 1024).toFixed(1)} KB</p>
          </button>
        ))}
      </div>

      {/* Right: content */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected && (
          <EmptyState icon={Mic} title="Select a transcription" description="Choose from the list to view its content" />
        )}
        {selected && (
          <>
            <div className="px-4 sm:px-6 py-3 border-b border-border flex items-center gap-3 shrink-0">
              <span className="font-mono text-sm text-accent truncate">{selected}</span>
              {text && <Badge>{detectLang(text)}</Badge>}
              <span className="ml-auto font-mono text-xs text-muted">{text.split(/\s+/).length} words</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {loading ? (
                <Skeleton lines={8} />
              ) : (
                <p className="font-mono text-sm text-text leading-relaxed whitespace-pre-wrap">{text}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
