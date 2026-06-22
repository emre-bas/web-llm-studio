import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

// A useState that mirrors its value to localStorage, so chat settings (system
// prompt, generation params) survive a page reload instead of resetting to
// defaults. Mirrors the resilient try/catch storage style used by
// useChatHistory — storage being unavailable or full just disables persistence.
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* quota exceeded / storage unavailable — settings just won't persist */
    }
  }, [key, value])

  return [value, setValue]
}
