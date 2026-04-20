import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, streamSSE } from '../api'
import { pushToast } from './Toast'
import { ChatPanel } from './ChatPanel'
import type { Course, Note, Transcription } from '../types'

interface Props { course: Course }

type View = 'preview' | 'edit'

export function NotesTab({ course }: Props) {
  const [notes, setNotes] = useState<Note[]>([])
  const [selected, setSelected] = useState<Note | null>(null)
  const [content, setContent] = useState('')
  const [editContent, setEditContent] = useState('')
  const [view, setView] = useState<View>('preview')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Generate note form
  const [showGen, setShowGen] = useState(false)
  const [downloads, setDownloads] = useState<{ name: string; path: string; is_video: boolean }[]>([])
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([])
  const [genDocPaths, setGenDocPaths] = useState<string[]>([])
  const [genTranscript, setGenTranscript] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState('')

  useEffect(() => { loadNotes() }, [course.id])

  function loadNotes() {
    api.notes().then(all => setNotes(all)).catch(() => {})
  }

  async function openNote(n: Note) {
    setSelected(n)
    setLoading(true)
    const r = await api.note(n.course, n.filename).catch(() => null)
    const text = r?.content ?? ''
    setContent(text)
    setEditContent(text)
    setLoading(false)
    setView('preview')
  }

  async function saveEdit() {
    if (!selected) return
    setSaving(true)
    await api.saveNote(selected.course, selected.filename, editContent).catch(() => {})
    setContent(editContent)
    setView('preview')
    setSaving(false)
    pushToast({ type: 'success', message: '✓ Note saved' })
  }

  async function openGenForm() {
    setShowGen(true)
    const [dl, tr] = await Promise.all([
      api.downloads().catch(() => []),
      api.transcriptions().catch(() => []),
    ])
    const safeCourse = (s: string) => s.replace(/[^a-zA-Z0-9 ._\u4e00-\u9fff-]/g, '_').trim()
    setDownloads(dl.filter(d => safeCourse(d.course) === safeCourse(course.name)))
    setTranscriptions(tr)
  }

  async function generate() {
    if (generating) return
    setGenerating(true)
    setGenProgress('')

    let transcript = genTranscript
    if (!transcript && genTranscript) {
      const r = await api.transcription(genTranscript).catch(() => null)
      transcript = r?.text ?? ''
    } else if (genTranscript) {
      const r = await api.transcription(genTranscript).catch(() => null)
      transcript = r?.text ?? ''
    }

    try {
      await streamSSE(
        '/notes/generate',
        { course_name: course.name, doc_paths: genDocPaths, transcript },
        delta => setGenProgress(p => p + delta),
      )
      pushToast({ type: 'success', message: '✓ Note generated' })
      loadNotes()
      setShowGen(false)
      setGenProgress('')
    } catch (e) {
      pushToast({ type: 'error', message: 'Generation failed' })
    } finally {
      setGenerating(false)
    }
  }

  const courseNotes = notes

  return (
    <div className="h-full flex">
      {/* Left: note list + generator */}
      <div className="w-56 shrink-0 border-r border-[var(--border)] flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
          <p className="font-mono text-xs text-[var(--text-muted)]">{courseNotes.length} notes</p>
          <button
            onClick={openGenForm}
            className="font-mono text-xs text-amber hover:text-amber-glow transition-colors"
          >
            + gen
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {courseNotes.length === 0 && (
            <p className="px-4 py-6 font-mono text-xs text-[var(--text-muted)]">
              no notes yet
            </p>
          )}
          {courseNotes.map(n => (
            <button
              key={n.path}
              onClick={() => openNote(n)}
              className={`w-full text-left px-4 py-3 border-b border-[var(--border)]/50 transition-colors ${
                selected?.path === n.path
                  ? 'bg-[var(--surface2)] border-l-2 border-l-amber text-amber'
                  : 'hover:bg-[var(--surface2)] text-[var(--text)]'
              }`}
            >
              <p className="font-mono text-xs truncate">{n.stem}</p>
              <p className="font-mono text-xs text-[var(--text-muted)] mt-0.5">
                {(n.size / 1024).toFixed(1)} KB
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Center: note content */}
      <div className="flex-1 flex flex-col min-w-0">
        {showGen && (
          <GenPanel
            downloads={downloads}
            transcriptions={transcriptions}
            docPaths={genDocPaths} setDocPaths={setGenDocPaths}
            transcript={genTranscript} setTranscript={setGenTranscript}
            generating={generating} progress={genProgress}
            onGenerate={generate}
            onClose={() => { setShowGen(false); setGenProgress('') }}
          />
        )}

        {!showGen && !selected && (
          <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
            <div className="text-center">
              <span className="text-5xl block mb-3 opacity-20">◈</span>
              <p className="font-mono text-sm">select a note or generate one</p>
            </div>
          </div>
        )}

        {!showGen && selected && (
          <>
            {/* Toolbar */}
            <div className="px-5 py-2.5 border-b border-[var(--border)] flex items-center gap-3 shrink-0">
              <span className="font-mono text-xs text-amber truncate flex-1">{selected.stem}</span>
              <div className="flex gap-1 shrink-0">
                {(['preview', 'edit'] as View[]).map(v => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`font-mono text-xs px-3 py-1 rounded transition-all ${
                      view === v
                        ? 'bg-amber/10 text-amber border border-amber/40'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    {v}
                  </button>
                ))}
                {view === 'edit' && (
                  <button
                    disabled={saving}
                    onClick={saveEdit}
                    className="font-mono text-xs px-3 py-1 rounded border border-sage/40 text-sage hover:bg-sage/10 disabled:opacity-50 ml-1"
                  >
                    {saving ? '…' : '✓ save'}
                  </button>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {loading ? (
                <div className="p-6 font-mono text-xs text-[var(--text-muted)] animate-pulse">loading<span className="cursor" /></div>
              ) : view === 'preview' ? (
                <div className="h-full overflow-y-auto p-8 bg-[var(--paper)]">
                  <div className="prose-notes max-w-2xl mx-auto">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                  </div>
                </div>
              ) : (
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className="w-full h-full p-6 bg-[var(--bg)] font-mono text-xs text-[var(--text)] leading-relaxed resize-none focus:outline-none"
                  spellCheck={false}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Right: chat */}
      <div className="w-80 shrink-0">
        <ChatPanel contextNote={content} />
      </div>
    </div>
  )
}

function GenPanel({
  downloads, transcriptions,
  docPaths, setDocPaths,
  transcript, setTranscript,
  generating, progress, onGenerate, onClose,
}: {
  downloads: { name: string; path: string }[]
  transcriptions: Transcription[]
  docPaths: string[]; setDocPaths: (v: string[]) => void
  transcript: string; setTranscript: (v: string) => void
  generating: boolean; progress: string
  onGenerate: () => void; onClose: () => void
}) {
  function toggleDoc(path: string) {
    if (docPaths.includes(path)) {
      setDocPaths(docPaths.filter(p => p !== path))
    } else {
      setDocPaths([...docPaths, path])
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-lg">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-mono text-sm text-amber">◈ generate note</h3>
          <button onClick={onClose} className="font-mono text-xs text-[var(--text-muted)] hover:text-[var(--text)]">✕</button>
        </div>

        <div className="space-y-4">
          {/* Documents: multi-select checklist */}
          <div>
            <label className="font-mono text-xs text-[var(--text-muted)] block mb-2">
              documents ({docPaths.length} selected)
            </label>
            <div className="space-y-1 max-h-48 overflow-y-auto border border-[var(--border)] rounded p-2">
              {downloads.length === 0 && (
                <p className="font-mono text-xs text-[var(--text-muted)] px-1">no documents</p>
              )}
              {downloads.map(d => (
                <label
                  key={d.path}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer font-mono text-xs transition-colors ${
                    docPaths.includes(d.path)
                      ? 'bg-amber/10 text-amber'
                      : 'text-[var(--text-muted)] hover:bg-[var(--surface2)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={docPaths.includes(d.path)}
                    onChange={() => toggleDoc(d.path)}
                    className="sr-only"
                  />
                  <span className="shrink-0">{docPaths.includes(d.path) ? '◈' : '○'}</span>
                  <span className="truncate">{d.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Transcriptions: single-select */}
          <div>
            <label className="font-mono text-xs text-[var(--text-muted)] block mb-1.5">transcription</label>
            <select
              value={transcript}
              onChange={e => setTranscript(e.target.value)}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-3 py-2 font-mono text-xs text-[var(--text)] focus:outline-none focus:border-amber/50"
            >
              <option value="">— none —</option>
              {transcriptions.map(t => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>

          <button
            disabled={generating || (docPaths.length === 0 && !transcript)}
            onClick={onGenerate}
            className="w-full font-mono text-xs py-2.5 rounded border border-amber/40 text-amber hover:bg-amber/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {generating ? '⟳ generating…' : '◈ generate'}
          </button>
        </div>

        {progress && (
          <div className="mt-5 p-4 bg-[var(--surface2)] rounded border border-[var(--border)] max-h-64 overflow-y-auto">
            <p className="font-mono text-xs text-sage leading-relaxed whitespace-pre-wrap">{progress}<span className="cursor" /></p>
          </div>
        )}
      </div>
    </div>
  )
}
