import type { CanvasFile, ChatMessage, Course, DownloadedItem, FileNode, MediaObject, Note, Task, Transcription } from './types'

const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path)
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json()
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json()
}

export interface VideoItem {
  id: string
  title: string
  duration: number
  thumbnail: string
  size: number
  cour_id: string
  courseBeginTime?: string
  courseEndTime?: string
}

export interface VideoPlay {
  id: string
  name: string
  index: number
  url: string
}

export interface PPTSlide {
  url: string
  sec: string
}

export const api = {
  // ── File Manager ──────────────────────────────────────────
  files:             (path?: string): Promise<FileNode[]> =>
                       get('/files' + (path ? `?path=${encodeURIComponent(path)}` : '')),
  fileDelete:        (path: string)                    => post('/files/delete', { path }),
  fileRename:        (path: string, newName: string)   => post('/files/rename', { path, newName }),
  fileMkdir:         (path: string, name: string)      => post('/files/mkdir', { path, name }),
  filePreview:       (path: string) => get<{ name: string; path: string; ext: string; content: string }>(`/files/preview?path=${encodeURIComponent(path)}`),
  fileDownloadUrl:   (path: string) => `${BASE}/files/download/${encodeURIComponent(path)}`,

  courses:           (): Promise<Course[]>          => get('/courses'),
  courseFiles:       (id: number): Promise<CanvasFile[]>     => get(`/courses/${id}/files`),
  courseVideos:      (id: number): Promise<MediaObject[]>    => get(`/courses/${id}/videos`),

  download:          (body: { type: string; course_id: number; course_name: string; item: object }) => post<{ task_id: string }>('/download', body),
  downloads:         (): Promise<DownloadedItem[]>   => get('/downloads'),

  transcribe:        (video_path: string, course_name: string) => post<{ task_id: string }>('/transcribe', { video_path, course_name }),
  transcriptions:    (): Promise<Transcription[]>    => get('/transcriptions'),
  transcription:     (name: string): Promise<{ name: string; text: string }> => get(`/transcriptions/${name}`),

  notes:             (): Promise<Note[]>             => get('/notes'),
  note:              (course: string, filename: string): Promise<{ content: string }> => get(`/notes/${course}/${filename}`),
  saveNote:          (course: string, filename: string, content: string) => put(`/notes/${course}/${filename}`, { content }),

  task:              (id: string): Promise<Task>     => get(`/tasks/${id}`),
  tasks:             (): Promise<Task[]>             => get('/tasks'),

  // ── 课堂录屏 ────────────────────────────────────────────────
  videoLogin:        ()                            => post<{ task_id: string }>('/video/login', {}),
  videoList:         (course_id: number): Promise<VideoItem[]> => get(`/video/courses/${course_id}/videos`),
  videoDownload:      (body: { course_id: number; course_name: string; video_id: string; title: string; play_index?: number }) =>
                       post<{ task_id: string }>('/video/download', body),
  videoPlays:         (video_id: string, title?: string): Promise<VideoPlay[]> => get(`/video/plays?video_id=${encodeURIComponent(video_id)}${title ? `&title=${encodeURIComponent(title)}` : ''}`),
  pptList:           (cour_id: string, course_id: number): Promise<PPTSlide[]> =>
                       get(`/video/ppt?cour_id=${cour_id}&course_id=${course_id}`),
  pptDownload:        (body: { course_name: string; video_title: string; cour_id: string }) =>
                       post<{ task_id: string }>('/video/ppt/download', body),
}

/** SSE streaming helper — calls onDelta for each chunk, returns full text */
export async function streamSSE(
  path: string,
  body: unknown,
  onDelta: (d: string) => void,
): Promise<void> {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok || !r.body) throw new Error(`${r.status}`)
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const obj = JSON.parse(line.slice(6))
          if (obj.delta) onDelta(obj.delta)
        } catch { /* skip */ }
      }
    }
  }
}

/** Stream chat messages */
export async function streamChat(
  messages: ChatMessage[],
  contextNote: string,
  onDelta: (d: string) => void,
): Promise<void> {
  return streamSSE('/chat', { messages, context_note: contextNote }, onDelta)
}
