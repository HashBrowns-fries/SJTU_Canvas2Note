import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Sparkles, Plus, Pencil, Trash2, Check, Loader2, X } from 'lucide-react'
import { api, streamSSE } from '../api'
import { pushToast } from './Toast'
import { ChatPanel } from './ChatPanel'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import { Skeleton } from './ui/Skeleton'
import { EmptyState } from './ui/EmptyState'
import { Modal } from './ui/Modal'
import type { Course, Note, Transcription } from '../types'
import type { PptSlideSet } from '../api'

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

  // Chat panel resizable width
  const [chatWidth, setChatWidth] = useState(() => Math.min(560, window.innerWidth * 0.35))
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startW.current = chatWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [chatWidth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const delta = startX.current - e.clientX
      const newW = Math.max(280, Math.min(900, startW.current + delta))
      setChatWidth(newW)
    }
    const onUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // Generate note form
  const [showGen, setShowGen] = useState(false)
  const [downloads, setDownloads] = useState<{ name: string; path: string; is_video: boolean }[]>([])
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([])
  const [genDocPaths, setGenDocPaths] = useState<string[]>([])
  const [genTranscripts, setGenTranscripts] = useState<string[]>([])
  const [genSlides, setGenSlides] = useState<PptSlideSet[]>([])
  const [genSlidePaths, setGenSlidePaths] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState('')

  // Rename state
  const [renamingNote, setRenamingNote] = useState<Note | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)

  useEffect(() => { loadNotes() }, [course.id])

  function loadNotes() {
    const norm = (s: string) =>
      s.replace(/[^a-zA-Z0-9一-鿿 ]/g, "_").replace(/\s+/g, "_").trim()
    api.notes().then(all => setNotes(
      all.filter((n: Note) =>
        norm(n.course) === norm(course.name) &&
        !n.filename.endsWith('_slides.md') &&
        !n.filename.endsWith('.txt')
      )
    )).catch(() => {})
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
    pushToast({ type: 'success', message: 'Note saved' })
  }

  async function deleteNote(n: Note) {
    if (!confirm(`Delete note "${n.stem}"? This cannot be undone.`)) return
    try {
      await api.deleteNote(n.course, n.filename)
      if (selected?.path === n.path) setSelected(null)
      loadNotes()
      pushToast({ type: 'success', message: 'Deleted' })
    } catch {
      pushToast({ type: 'error', message: 'Delete failed' })
    }
  }

  function startRename(n: Note) {
    setRenamingNote(n)
    setRenameValue(n.stem)
  }

  async function confirmRename() {
    if (!renamingNote || !renameValue.trim()) return
    const newStem = renameValue.trim()
    if (newStem === renamingNote.stem) { setRenamingNote(null); return }
    setRenaming(true)
    try {
      await api.renameNote(renamingNote.course, renamingNote.filename, newStem + '.md')
      if (selected?.path === renamingNote.path) {
        setSelected({ ...renamingNote, stem: newStem, filename: newStem + '.md' })
      }
      loadNotes()
      setRenamingNote(null)
      pushToast({ type: 'success', message: 'Renamed' })
    } catch {
      pushToast({ type: 'error', message: 'Rename failed, file may exist' })
    } finally {
      setRenaming(false)
    }
  }

  async function openGenForm() {
    setShowGen(true)
    const [dl, tr, slides] = await Promise.all([
      api.downloads().catch(() => []),
      api.transcriptions().catch(() => []),
      api.pptSlidesList(course.name).catch(() => []),
    ])
    setDownloads(dl.filter((d: any) => d.course === course.name))
    setTranscriptions(tr.filter((t: any) => t.course === course.name))
    setGenSlides(slides)
  }

  async function generate() {
    if (generating) return
    setGenerating(true)
    setGenProgress('')

    const transcriptText = (await Promise.all(
      genTranscripts.map(name => api.transcription(name).catch(() => ({ name, text: '' })))
    )).map(r => r.text).filter(t => t).join('\n\n')

    try {
      await streamSSE(
        '/notes/generate',
        { course_name: course.name, doc_paths: genDocPaths, transcript: transcriptText, slide_dirs: genSlidePaths },
        delta => setGenProgress(p => p + delta),
        status => setGenProgress(p => p + '\n' + status + '\n'),
      )
      pushToast({ type: 'success', message: 'Note generated' })
      loadNotes()
      setShowGen(false)
      setGenProgress('')
    } catch {
      pushToast({ type: 'error', message: 'Generation failed' })
    } finally {
      setGenerating(false)
    }
  }

  const courseNotes = notes

  return (
    <div className="h-full flex">
      {/* Left: note list */}
      <div className="w-48 sm:w-56 shrink-0 border-r border-border flex flex-col">
        <div className="px-3 sm:px-4 py-3 border-b border-border flex items-center justify-between">
          <p className="font-mono text-xs text-muted truncate">{courseNotes.length} notes</p>
          <Button variant="ghost" size="sm" onClick={openGenForm}><Plus size={12} /> gen</Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {courseNotes.length === 0 && (
            <p className="px-4 py-6 font-mono text-xs text-muted">no notes yet</p>
          )}
          {courseNotes.map(n => (
            <div key={n.path} className="group relative">
              <button
                onClick={() => openNote(n)}
                className={`w-full text-left px-3 sm:px-4 py-3 border-b border-border/50 transition-colors ${
                  selected?.path === n.path
                    ? 'bg-brand-bg border-l-[3px] border-l-brand text-brand'
                    : 'hover:bg-surface2 text-text'
                }`}
              >
                <p className="font-mono text-xs truncate">{n.stem}</p>
                <p className="font-mono text-xs text-muted mt-0.5">{(n.size / 1024).toFixed(1)} KB</p>
              </button>

              {/* Hover actions */}
              <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex gap-0.5 bg-surface rounded-lg border border-border p-0.5">
                <button
                  onClick={(e) => { e.stopPropagation(); startRename(n) }}
                  className="p-1 rounded text-muted hover:text-brand hover:bg-brand-bg transition-colors"
                  title="Rename"
                ><Pencil size={12} /></button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteNote(n) }}
                  className="p-1 rounded text-muted hover:text-error hover:bg-error-bg transition-colors"
                  title="Delete"
                ><Trash2 size={12} /></button>
              </div>
            </div>
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
            transcriptPaths={genTranscripts} setTranscriptPaths={setGenTranscripts}
            slideSets={genSlides}
            slidePaths={genSlidePaths} setSlidePaths={setGenSlidePaths}
            generating={generating} progress={genProgress}
            onGenerate={generate}
            onClose={() => { setShowGen(false); setGenProgress('') }}
          />
        )}

        {!showGen && !selected && (
          <EmptyState icon={Sparkles} title="Select a note or generate one" />
        )}

        {!showGen && selected && (
          <>
            {/* Toolbar */}
            <div className="px-4 sm:px-5 py-2.5 border-b border-border flex items-center gap-3 shrink-0">
              <span className="font-mono text-xs text-brand truncate flex-1">{selected.stem}</span>
              <div className="flex gap-1 shrink-0">
                {(['preview', 'edit'] as View[]).map(v => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`font-mono text-xs px-3 py-1 rounded-lg transition-all ${
                      view === v
                        ? 'bg-brand-bg text-brand border border-brand/40'
                        : 'text-muted hover:text-text'
                    }`}
                  >
                    {v}
                  </button>
                ))}
                {view === 'edit' && (
                  <Button variant="primary" size="sm" loading={saving} onClick={saveEdit}>
                    <Check size={12} /> save
                  </Button>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {loading ? (
                <div className="p-6 font-mono text-xs text-muted animate-pulse">loading<span className="cursor" /></div>
              ) : view === 'preview' ? (
                <div className="h-full overflow-y-auto p-6 sm:p-8 paper-bg">
                  <div className="prose-notes max-w-2xl mx-auto">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{content}</ReactMarkdown>
                  </div>
                </div>
              ) : (
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className="w-full h-full p-6 bg-bg font-mono text-xs text-text leading-relaxed resize-none focus:outline-none"
                  spellCheck={false}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Resize handle + Chat */}
      <div className="hidden xl:flex">
        {/* Drag handle */}
        <div
          className="w-1.5 shrink-0 cursor-col-resize hover:bg-brand/20 active:bg-brand/40 transition-colors border-l border-border"
          onMouseDown={onDragStart}
        />
        {/* Chat panel */}
        <div className="border-l border-border" style={{ width: chatWidth }}>
          <ChatPanel conversationId={selected ? `${selected.course}_${selected.stem}` : ''} contextNote={content} />
        </div>
      </div>

      {/* Rename modal */}
      <Modal open={!!renamingNote} onClose={() => setRenamingNote(null)} title="Rename Note" size="sm">
        <div className="space-y-4">
          <input
            type="text"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && confirmRename()}
            className="field-input"
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setRenamingNote(null)}>Cancel</Button>
            <Button variant="primary" disabled={renaming || !renameValue.trim()} onClick={confirmRename}>
              {renaming ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Confirm
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function GenPanel({
  downloads, transcriptions,
  docPaths, setDocPaths,
  transcriptPaths, setTranscriptPaths,
  slideSets, slidePaths, setSlidePaths,
  generating, progress, onGenerate, onClose,
}: {
  downloads: { name: string; path: string }[]
  transcriptions: Transcription[]
  docPaths: string[]; setDocPaths: (v: string[]) => void
  transcriptPaths: string[]; setTranscriptPaths: (v: string[]) => void
  slideSets: PptSlideSet[]
  slidePaths: string[]; setSlidePaths: (v: string[]) => void
  generating: boolean; progress: string
  onGenerate: () => void; onClose: () => void
}) {
  function toggleDoc(path: string) {
    if (docPaths.includes(path)) setDocPaths(docPaths.filter(p => p !== path))
    else setDocPaths([...docPaths, path])
  }
  function toggleTranscript(name: string) {
    if (transcriptPaths.includes(name)) setTranscriptPaths(transcriptPaths.filter(p => p !== name))
    else setTranscriptPaths([...transcriptPaths, name])
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-lg">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-mono text-sm text-brand flex items-center gap-2">
            <Sparkles size={14} /> Generate Note
          </h3>
          <Button variant="ghost" size="sm" onClick={onClose}><X size={14} /></Button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="font-mono text-xs text-muted block mb-2">
              documents ({docPaths.length} selected)
            </label>
            <div className="space-y-1 max-h-48 overflow-y-auto border border-border rounded-lg p-2">
              {downloads.length === 0 && <p className="font-mono text-xs text-muted px-1">no documents</p>}
              {downloads.map(d => (
                <label
                  key={d.path}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer font-mono text-xs transition-colors ${
                    docPaths.includes(d.path) ? 'bg-brand-bg text-brand' : 'text-muted hover:bg-surface2'
                  }`}
                >
                  <input type="checkbox" checked={docPaths.includes(d.path)} onChange={() => toggleDoc(d.path)} className="sr-only" />
                  <span className="shrink-0">{docPaths.includes(d.path) ? <Sparkles size={10} /> : '○'}</span>
                  <span className="truncate">{d.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="font-mono text-xs text-muted block mb-2">
              transcriptions ({transcriptPaths.length} selected)
            </label>
            <div className="space-y-1 max-h-48 overflow-y-auto border border-border rounded-lg p-2">
              {transcriptions.length === 0 && <p className="font-mono text-xs text-muted px-1">no transcriptions</p>}
              {transcriptions.map(t => (
                <label
                  key={t.name}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer font-mono text-xs transition-colors ${
                    transcriptPaths.includes(t.name) ? 'bg-brand-bg text-brand' : 'text-muted hover:bg-surface2'
                  }`}
                >
                  <input type="checkbox" checked={transcriptPaths.includes(t.name)} onChange={() => toggleTranscript(t.name)} className="sr-only" />
                  <span className="shrink-0">{transcriptPaths.includes(t.name) ? <Sparkles size={10} /> : '○'}</span>
                  <span className="truncate">{t.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="font-mono text-xs text-muted block mb-2">
              PPT slides ({slidePaths.length} selected)
            </label>
            <div className="space-y-1 max-h-48 overflow-y-auto border border-border rounded-lg p-2">
              {slideSets.length === 0 && <p className="font-mono text-xs text-muted px-1">no slides — use Videos tab to download PPT</p>}
              {slideSets.map(s => (
                <label
                  key={s.dir}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer font-mono text-xs transition-colors ${
                    slidePaths.includes(s.dir) ? 'bg-accent-bg text-accent' : 'text-muted hover:bg-surface2'
                  }`}
                >
                  <input type="checkbox" checked={slidePaths.includes(s.dir)} onChange={() => {
                    if (slidePaths.includes(s.dir)) setSlidePaths(slidePaths.filter(p => p !== s.dir))
                    else setSlidePaths([...slidePaths, s.dir])
                  }} className="sr-only" />
                  <span className="shrink-0">{slidePaths.includes(s.dir) ? <Sparkles size={10} /> : '○'}</span>
                  <span className="truncate">{s.title}</span>
                  <span className="ml-auto text-faint shrink-0">{s.count}p</span>
                </label>
              ))}
            </div>
          </div>

          <Button
            variant="primary"
            size="lg"
            className="w-full justify-center"
            disabled={generating || (docPaths.length === 0 && transcriptPaths.length === 0 && slidePaths.length === 0)}
            onClick={onGenerate}
            loading={generating}
          >
            <Sparkles size={14} /> Generate
          </Button>
        </div>

        {progress && (
          <div className="mt-5 p-4 bg-surface2 rounded-lg border border-border max-h-64 overflow-y-auto">
            <p className="font-mono text-xs text-accent leading-relaxed whitespace-pre-wrap">{progress}<span className="cursor" /></p>
          </div>
        )}
      </div>
    </div>
  )
}
