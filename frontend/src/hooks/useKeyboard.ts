import { useEffect, useRef } from 'react'

interface Action {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  handler: () => void
  description?: string
}

export function useKeyboard(actions: Action[], enabled = true) {
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    if (!enabled) return

    function handle(e: KeyboardEvent) {
      for (const a of actionsRef.current) {
        const matchKey = e.key.toLowerCase() === a.key.toLowerCase()
        const matchCtrl = !!a.ctrl === (e.ctrlKey || e.metaKey)
        const matchAlt = !!a.alt === e.altKey
        const matchShift = !!a.shift === e.shiftKey
        if (matchKey && matchCtrl && matchAlt && matchShift) {
          e.preventDefault()
          a.handler()
          return
        }
      }
    }

    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [enabled])
}
