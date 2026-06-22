import { useState, useEffect, useCallback, useRef } from 'react'
import { engineManager } from '../engines/engineManager'
import { chooseSpeechVoice, parseSpeechLanguageCode } from '../utils/speechLanguage'

export interface SpeechController {
  /** Whether the browser exposes the SpeechSynthesis API. */
  supported: boolean
  /** Whether something is being spoken right now. */
  speaking: boolean
  /** Id of the message currently being spoken (for per-message button state). */
  speakingId: string | null
  /** Speak `text`; an optional `id` lets the UI mark which message is active. */
  speak: (text: string, id?: string) => void
  cancel: () => void
}

const LANGUAGE_DETECTION_PROMPT =
  'Identify the primary natural language of the text below. ' +
  'Return only one BCP-47 language tag, optionally including a region. ' +
  'Do not return a language name. Return und if unknown.'
const LANGUAGE_SAMPLE_LIMIT = 512
// Defensive upper bound on languages listed in the detection prompt. Base-level
// dedup already keeps this small (a device rarely speaks more than a handful of
// distinct languages); the cap only guards against a pathological voice list.
const LANGUAGE_CANDIDATE_LIMIT = 40
const SPEECH_START_DELAY_MS = 120
const SPEECH_LEADING_GUARD = '\u200b'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function fallbackSpeechLanguage(): string {
  return document.documentElement.lang || navigator.language || 'en-US'
}

// Reduce BCP-47 tags to unique base languages (en-US, en-GB → en). Detection
// only needs to know which languages the device can speak; the region is chosen
// afterwards by chooseSpeechVoice from the user's preferences. The model may
// still return a region of its own (e.g. pt-BR) — parseSpeechLanguageCode keeps it.
function baseLanguages(languages: readonly string[]): string[] {
  const seen = new Set<string>()
  const bases: string[] = []
  for (const lang of languages) {
    const base = lang.trim().toLowerCase().split(/[-_]/)[0]
    if (base && !seen.has(base)) {
      seen.add(base)
      bases.push(base)
    }
  }
  return bases
}

// Outcome of a detection attempt. `unknown` (model ran but couldn't identify) is
// permanent and worth caching; `unavailable` (engine busy / not ready) is
// transient and must be retried later — so the two are kept distinct rather than
// both collapsing to null.
type DetectionResult =
  | { status: 'detected'; language: string }
  | { status: 'unknown' }
  | { status: 'unavailable' }

// Strip code so detection judges prose, not English-looking keywords — and so the
// """ delimiter below can't collide with triple-quoted strings in the sample.
// Falls back to the raw text when stripping leaves too little to go on.
function sanitizeForDetection(text: string): string {
  const stripped = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const base = stripped.length >= 16 ? stripped : text.trim()
  return base.slice(0, LANGUAGE_SAMPLE_LIMIT)
}

async function detectSpeechLanguage(
  text: string,
  candidateLanguages: readonly string[]
): Promise<DetectionResult> {
  // 'ready' already implies the engine is loaded.
  if (engineManager.getStatus() !== 'ready') return { status: 'unavailable' }

  const sample = sanitizeForDetection(text)
  if (!sample) return { status: 'unknown' }

  try {
    const candidates = baseLanguages(candidateLanguages).slice(0, LANGUAGE_CANDIDATE_LIMIT)
    const candidateLine =
      candidates.length > 0
        ? `\nLanguages available on this device: ${candidates.join(', ')}.` +
          '\nPrefer one of these when it matches the text.'
        : ''
    const raw = await engineManager.generate(
      [{
        role: 'user',
        content: `${LANGUAGE_DETECTION_PROMPT}${candidateLine}\n\nText:\n"""${sample}"""\n\nLanguage tag:`,
      }],
      {
        temperature: 0,
        maxTokens: 12,
        topP: 1,
        stop: ['\n'],
      }
    )
    const language = parseSpeechLanguageCode(raw, candidates)
    return language ? { status: 'detected', language } : { status: 'unknown' }
  } catch {
    // Generation failed (e.g. engine torn down mid-call) — transient, allow retry.
    return { status: 'unavailable' }
  }
}

// Cache + in-flight dedup around detection. Caches a detected language and a
// confirmed `unknown` (as null), but never an `unavailable` result so a busy
// engine is retried. Concurrent calls for the same text share one detection.
async function resolveDetectedLanguage(
  cacheKey: string,
  text: string,
  candidateLanguages: readonly string[],
  cache: Map<string, string | null>,
  inflight: Map<string, Promise<string | null>>
): Promise<string | null> {
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null
  const existing = inflight.get(cacheKey)
  if (existing) return existing

  const pending = (async () => {
    const result = await detectSpeechLanguage(text, candidateLanguages)
    if (result.status === 'detected') {
      cache.set(cacheKey, result.language)
      return result.language
    }
    if (result.status === 'unknown') cache.set(cacheKey, null)
    return null
  })().finally(() => inflight.delete(cacheKey))

  inflight.set(cacheKey, pending)
  return pending
}

// Text-to-speech via the browser's built-in SpeechSynthesis. This runs entirely
// on-device (OS voices) — no network, unlike the speech *recognition* side — so
// it fits the "everything stays local" promise without caveats.
export function useSpeech(): SpeechController {
  const supported =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window
  const [speaking, setSpeaking] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const runRef = useRef(0)
  // Detected language per text prefix: a string, or null for a confirmed
  // "unknown" (negative cache). A missing key means "not yet resolved".
  const languageCacheRef = useRef(new Map<string, string | null>())
  // In-flight detections per text prefix, so rapid repeat clicks share one call.
  const inflightDetectionRef = useRef(new Map<string, Promise<string | null>>())

  useEffect(() => {
    if (!supported) return
    const synth = window.speechSynthesis
    const refreshVoices = () => setVoices(synth.getVoices())
    refreshVoices()
    synth.addEventListener('voiceschanged', refreshVoices)
    return () => synth.removeEventListener('voiceschanged', refreshVoices)
  }, [supported])

  const cancel = useCallback(() => {
    if (!supported) return
    runRef.current++
    window.speechSynthesis.cancel()
    setSpeaking(false)
    setSpeakingId(null)
  }, [supported])

  const speak = useCallback(
    (text: string, id?: string) => {
      const trimmed = text.trim()
      if (!supported || !trimmed) return
      const runId = runRef.current + 1
      runRef.current = runId
      window.speechSynthesis.cancel() // stop anything already speaking
      setSpeaking(true)
      setSpeakingId(id ?? null)

      void (async () => {
        const fallbackLanguage = fallbackSpeechLanguage()
        const preferredLanguages: readonly string[] =
          navigator.languages?.length ? navigator.languages : [fallbackLanguage]
        // Re-read voices both before and after the async gap: getVoices() can be
        // empty on first paint and populate later (Chrome fires `voiceschanged`).
        const liveVoices = () =>
          voices.length > 0 ? voices : window.speechSynthesis.getVoices()

        const candidateLanguages = [
          ...liveVoices().map((voice) => voice.lang),
          ...preferredLanguages,
        ]
        const cacheKey = trimmed.slice(0, LANGUAGE_SAMPLE_LIMIT)
        const detectedLanguage = await resolveDetectedLanguage(
          cacheKey,
          trimmed,
          candidateLanguages,
          languageCacheRef.current,
          inflightDetectionRef.current
        )
        if (runRef.current !== runId) return

        await wait(SPEECH_START_DELAY_MS)
        if (runRef.current !== runId) return

        const utter = new SpeechSynthesisUtterance(`${SPEECH_LEADING_GUARD}${text}`)
        const language = detectedLanguage || fallbackLanguage
        const voice = chooseSpeechVoice(liveVoices(), language, preferredLanguages)
        utter.lang = voice?.lang || language
        if (voice) utter.voice = voice
        utter.onend = () => {
          if (runRef.current !== runId) return
          setSpeaking(false)
          setSpeakingId(null)
        }
        utter.onerror = () => {
          if (runRef.current !== runId) return
          setSpeaking(false)
          setSpeakingId(null)
        }
        window.speechSynthesis.resume()
        window.speechSynthesis.speak(utter)
      })()
    },
    [supported, voices]
  )

  // Stop any in-flight speech when the component using this unmounts.
  useEffect(() => () => { if (supported) window.speechSynthesis.cancel() }, [supported])

  return { supported, speaking, speakingId, speak, cancel }
}
