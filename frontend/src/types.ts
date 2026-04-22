export interface Course {
  id: number
  name: string
  course_code: string
}

export interface CanvasFile {
  id: number
  display_name: string
  url: string
  size: number
  'content-type': string
  created_at: string
}

export interface MediaObject {
  media_id: string
  title: string
  media_type: string
  duration?: number
}

export interface Task {
  id: string
  kind: string
  status: 'pending' | 'running' | 'done' | 'error' | 'downloading'
  progress: number
  total?: number
  result: string | null
  error: string | null
}

export interface DownloadedItem {
  path: string
  name: string
  course: string
  size: number
  is_video: boolean
}

export interface Transcription {
  name: string
  path: string
  size: number
  course: string
}

export interface Note {
  filename: string
  stem: string
  course: string
  path: string
  size: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export type TabId = 'files' | 'local' | 'videos' | 'transcriptions' | 'notes'

export interface FileNode {
  name:     string
  path:     string
  type:     'file' | 'dir'
  ext?:     string
  size?:    number
  fileType?: 'text' | 'binary' | 'other'
  modified: string
}
