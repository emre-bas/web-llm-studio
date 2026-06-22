import { useState, useEffect, useRef, useCallback } from 'react'

// Minimal typings for the Web Speech API — it isn't in TS's default DOM lib and
// only Chromium/WebKit ship it (as `webkitSpeechRecognition`).
interface SpeechRecognitionAlternative { transcript: string }
interface SpeechRecognitionResult {
  readonly length: number
  isFinal: boolean
  [index: number]: SpeechRecognitionAlternative
}
interface SpeechRecognitionResultList {
  readonly length: number
  [index: number]: SpeechRecognitionResult
}
interface SpeechRecognitionEvent {
  resultIndex: number
  results: SpeechRecognitionResultList
}
interface SpeechRecognitionErrorEvent { error: string }
interface SpeechRecognitionInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export interface SpeechRecognitionController {
  /** Whether the browser exposes speech recognition (Chromium/WebKit only). */
  supported: boolean
  listening: boolean
  start: () => void
  stop: () => void
}

// Speech-to-text via the Web Speech API. NOTE: in Chrome/Edge the audio is sent
// to the browser vendor's cloud service — this is the one feature that leaves the
// device, so the UI must say so. The transcript (accumulated finals + the live
// interim segment) is delivered to `onTranscript` on every update.
export function useSpeechRecognition(
  onTranscript: (text: string) => void
): SpeechRecognitionController {
  const ctorRef = useRef<SpeechRecognitionCtor | null>(getRecognitionCtor())
  const supported = !!ctorRef.current
  const [listening, setListening] = useState(false)
  const recRef = useRef<SpeechRecognitionInstance | null>(null)
  const finalRef = useRef('')

  // Keep the latest callback without re-creating start().
  const onTranscriptRef = useRef(onTranscript)
  useEffect(() => { onTranscriptRef.current = onTranscript }, [onTranscript])

  const stop = useCallback(() => {
    recRef.current?.stop()
  }, [])

  const start = useCallback(() => {
    const Ctor = ctorRef.current
    if (!Ctor || recRef.current) return
    const rec = new Ctor()
    rec.lang = navigator.language || 'en-US'
    rec.continuous = true
    rec.interimResults = true
    finalRef.current = ''

    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const txt = res[0]?.transcript ?? ''
        if (res.isFinal) finalRef.current += txt
        else interim += txt
      }
      onTranscriptRef.current((finalRef.current + interim).trim())
    }
    rec.onerror = () => { setListening(false); recRef.current = null }
    rec.onend = () => { setListening(false); recRef.current = null }

    recRef.current = rec
    setListening(true)
    rec.start()
  }, [])

  // Abort recognition on unmount so the mic is released.
  useEffect(() => () => { recRef.current?.abort() }, [])

  return { supported, listening, start, stop }
}
