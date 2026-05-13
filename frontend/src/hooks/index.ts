import { useEffect, useRef } from 'react'

export { useTheme } from './useTheme'
export { useKeyboard } from './useKeyboard'

export function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [dep])
  return ref
}
