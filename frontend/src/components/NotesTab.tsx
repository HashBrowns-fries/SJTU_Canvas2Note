import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, streamSSE } from '../api'
import { pushToast } from './Toast'
import { ChatPanel } from './ChatPanel'
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

  // Hover state for action buttons
  const [hoveredNote, setHoveredNote] = useState<string | null>(null)

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
    pushToast({ type: 'success', message: '✓ Note saved' })
  }

  async function deleteNote(n: Note) {
    if (!confirm(`删除笔记「${n.stem}」？此操作不可恢复。`)) return
    try {
      await api.deleteNote(n.course, n.filename)
      if (selected?.path === n.path) setSelected(null)
      loadNotes()
      pushToast({ type: 'success', message: '✓ 已删除' })
    } catch {
      pushToast({ type: 'error', message: '删除失败' })
    }
  }

  function startRename(n: Note) {
    setRenamingNote(n)
    setRenameValue(n.stem)
  }

  async function confirmRename() {
    if (!renamingNote || !renameValue.trim()) return
    const newStem = renameValue.trim()
    if (newStem === renamingNote.stem) {
      setRenamingNote(null)
      return
    }
    setRenaming(true)
    try {
      await api.renameNote(renamingNote.course, renamingNote.filename, newStem + '.md')
      if (selected?.path === renamingNote.path) {
        setSelected({ ...renamingNote, stem: newStem, filename: newStem + '.md' })
      }
      loadNotes()
      setRenamingNote(null)
      pushToast({ type: 'success', message: '✓ 已重命名' })
    } catch {
      pushToast({ type: 'error', message: '重命名失败，可能已存在同名文件' })
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
    setDownloads(dl.filter(d => d.course === course.name))
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
          <p className="font-mono text-xs text-[var(--muted)]">{courseNotes.length} notes</p>
          <button
            onClick={openGenForm}
            className="font-mono text-xs text-[var(--green)] hover:text-[var(--green-glow)] transition-colors"
          >
            + gen
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {courseNotes.length === 0 && (
            <p className="px-4 py-6 font-mono text-xs text-[var(--muted)]">
              no notes yet
            </p>
          )}
          {courseNotes.map(n => (
            <div
              key={n.path}
              onMouseEnter={() => setHoveredNote(n.path)}
              onMouseLeave={() => setHoveredNote(null)}
            >
              <button
                onClick={() => openNote(n)}
                className={`w-full text-left px-4 py-3 border-b border-[var(--border)]/50 transition-colors ${
                  selected?.path === n.path
                    ? 'bg-[var(--green-bg)] border-l-[3px] border-l-[var(--green)] text-[var(--green)]'
                    : 'hover:bg-[var(--surface2)] text-[var(--ink)]'
                }`}
              >
                <p className="font-mono text-xs truncate pr-16">{n.stem}</p>
                <p className="font-mono text-xs text-[var(--muted)] mt-0.5">
                  {(n.size / 1024).toFixed(1)} KB
                </p>
              </button>

              {/* Hover action buttons */}
              {hoveredNote === n.path && (
                <div className="relative">
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 z-10">
                    <button
                      onClick={(e) => { e.stopPropagation(); startRename(n) }}
                      className="font-mono text-xs px-2 py-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--green)] hover:border-[var(--green)]/40 transition-all"
                      title="重命名"
                    >
                      ✎
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteNote(n) }}
                      className="font-mono text-xs px-2 py-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--rust)] hover:border-[var(--rust)]/40 transition-all"
                      title="删除"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
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
          <div className="flex-1 flex items-center justify-center text-[var(--muted)]">
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
              <span className="font-mono text-xs text-[var(--green)] truncate flex-1">{selected.stem}</span>
              <div className="flex gap-1 shrink-0">
                {(['preview', 'edit'] as View[]).map(v => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`font-mono text-xs px-3 py-1 rounded-lg transition-all ${
                      view === v
                        ? 'bg-[var(--green-bg)] text-[var(--green)] border border-[var(--green)]/40'
                        : 'text-[var(--muted)] hover:text-[var(--ink)]'
                    }`}
                  >
                    {v}
                  </button>
                ))}
                {view === 'edit' && (
                  <button
                    disabled={saving}
                    onClick={saveEdit}
                    className="font-mono text-xs px-3 py-1 rounded-lg border border-[var(--moss)]/40 text-[var(--moss)] hover:bg-[var(--moss-bg)] disabled:opacity-50 ml-1 transition-all"
                  >
                    {saving ? '…' : '✓ save'}
                  </button>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {loading ? (
                <div className="p-6 font-mono text-xs text-[var(--muted)] animate-pulse">loading<span className="cursor" /></div>
              ) : view === 'preview' ? (
                <div className="h-full overflow-y-auto p-8 paper-bg">
                  <div className="prose-notes max-w-2xl mx-auto">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                  </div>
                </div>
              ) : (
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className="w-full h-full p-6 bg-[var(--bg)] font-mono text-xs text-[var(--ink)] leading-relaxed resize-none focus:outline-none"
                  spellCheck={false}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Right: chat */}
      <div className="w-[38rem] shrink-0">
        <ChatPanel
          conversationId={selected ? `${selected.course}_${selected.stem}` : ''}
          contextNote={content}
        />
      </div>

      {/* Rename modal */}
      {renamingNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/40 backdrop-blur-sm">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 w-80 shadow-xl">
            <h3 className="font-mono text-sm text-[var(--green)] mb-4">◈ 重命名笔记</h3>
            <input
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmRename()}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 font-mono text-xs text-[var(--ink)] mb-4 focus:outline-none focus:border-[var(--green)]/50 transition-all"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRenamingNote(null)}
                className="font-mono text-xs px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
              >
                取消
              </button>
              <button
                disabled={renaming || !renameValue.trim()}
                onClick={confirmRename}
                className="font-mono text-xs px-4 py-2 rounded-lg border border-[var(--green)]/40 text-[var(--green)] hover:bg-[var(--green-bg)] disabled:opacity-50 transition-colors"
              >
                {renaming ? '…' : '✓ 确定'}
              </button>
            </div>
          </div>
        </div>
      )}
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
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-lg">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-mono text-sm text-[var(--green)]">◈ generate note</h3>
          <button onClick={onClose} className="font-mono text-xs text-[var(--muted)] hover:text-[var(--ink)]">✕</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="font-mono text-xs text-[var(--muted)] block mb-2">
              documents ({docPaths.length} selected)
            </label>
            <div className="space-y-1 max-h-48 overflow-y-auto border border-[var(--border)] rounded-lg p-2">
              {downloads.length === 0 && (
                <p className="font-mono text-xs text-[var(--muted)] px-1">no documents</p>
              )}
              {downloads.map(d => (
                <label
                  key={d.path}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer font-mono text-xs transition-colors ${
                    docPaths.includes(d.path)
                      ? 'bg-[var(--green-bg)] text-[var(--green)]'
                      : 'text-[var(--muted)] hover:bg-[var(--surface2)]'
                  }`}
                >
                  <input type="checkbox" checked={docPaths.includes(d.path)} onChange={() => toggleDoc(d.path)} className="sr-only" />
                  <span className="shrink-0">{docPaths.includes(d.path) ? '◈' : '○'}</span>
                  <span className="truncate">{d.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="font-mono text-xs text-[var(--muted)] block mb-2">
              transcriptions ({transcriptPaths.length} selected)
            </label>
            <div className="space-y-1 max-h-48 overflow-y-auto border border-[var(--border)] rounded-lg p-2">
              {transcriptions.length === 0 && (
                <p className="font-mono text-xs text-[var(--muted)] px-1">no transcriptions</p>
              )}
              {transcriptions.map(t => (
                <label
                  key={t.name}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer font-mono text-xs transition-colors ${
                    transcriptPaths.includes(t.name)
                      ? 'bg-[var(--green-bg)] text-[var(--green)]'
                      : 'text-[var(--muted)] hover:bg-[var(--surface2)]'
                  }`}
                >
                  <input type="checkbox" checked={transcriptPaths.includes(t.name)} onChange={() => toggleTranscript(t.name)} className="sr-only" />
                  <span className="shrink-0">{transcriptPaths.includes(t.name) ? '◈' : '○'}</span>
                  <span className="truncate">{t.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="font-mono text-xs text-[var(--muted)] block mb-2">
              PPT slides ({slidePaths.length} selected)
            </label>
            <div className="space-y-1 max-h-48 overflow-y-auto border border-[var(--border)] rounded-lg p-2">
              {slideSets.length === 0 && (
                <p className="font-mono text-xs text-[var(--muted)] px-1">no slides — use Videos tab to download PPT</p>
              )}
              {slideSets.map(s => (
                <label
                  key={s.dir}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer font-mono text-xs transition-colors ${
                    slidePaths.includes(s.dir)
                      ? 'bg-[var(--moss-bg)] text-[var(--moss)]'
                      : 'text-[var(--muted)] hover:bg-[var(--surface2)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={slidePaths.includes(s.dir)}
                    onChange={() => {
                      if (slidePaths.includes(s.dir)) setSlidePaths(slidePaths.filter(p => p !== s.dir))
                      else setSlidePaths([...slidePaths, s.dir])
                    }}
                    className="sr-only"
                  />
                  <span className="shrink-0">{slidePaths.includes(s.dir) ? '◈' : '○'}</span>
                  <span className="truncate">{s.title}</span>
                  <span className="ml-auto text-[var(--faint)] shrink-0">{s.count}p</span>
                </label>
              ))}
            </div>
          </div>

          <button
            disabled={generating || (docPaths.length === 0 && transcriptPaths.length === 0 && slidePaths.length === 0)}
            onClick={onGenerate}
            className="w-full font-mono text-xs py-2.5 rounded-lg border border-[var(--green)]/40 text-[var(--green)] hover:bg-[var(--green-bg)] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {generating ? '⟳ generating…' : '◈ generate'}
          </button>
        </div>

        {progress && (
          <div className="mt-5 p-4 bg-[var(--surface2)] rounded-lg border border-[var(--border)] max-h-64 overflow-y-auto">
            <p className="font-mono text-xs text-[var(--moss)] leading-relaxed whitespace-pre-wrap">{progress}<span className="cursor" /></p>
          </div>
        )}
      </div>
    </div>
  )
}