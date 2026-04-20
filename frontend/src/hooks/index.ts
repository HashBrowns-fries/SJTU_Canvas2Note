import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Task } from '../types'

export function useTaskPoller(
  taskIds: string[],
  onDone: (task: Task) => void,
) {
  useEffect(() => {
    if (!taskIds.length) return
    const interval = setInterval(async () => {
      for (const id of taskIds) {
        const t = await api.task(id).catch(() => null)
        if (t && (t.status === 'done' || t.status === 'error')) {
          onDone(t)
        }
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [taskIds, onDone])
}

export function useActiveTasks() {
  const [active, setActive] = useState<Task[]>([])

  useEffect(() => {
    const interval = setInterval(async () => {
      const all = await api.tasks().catch(() => [])
      setActive(all.filter(t => t.status === 'pending' || t.status === 'running'))
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  return active
}

export function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [dep])
  return ref
}
