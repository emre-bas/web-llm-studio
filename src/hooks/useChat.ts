import { useState, useCallback, useRef } from 'react'
import { usePersistentState } from './usePersistentState'
import { engineManager } from '../engines/engineManager'

// Default chat settings — exported so "Reset All Settings" restores the same
// values this hook initialises with (single source of truth).
export const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant. Reply in the user\'s language.'
import type { ChatMessage, ContentPart, GenerateOptions } from '../engines/base'

// Some chat templates have no `system` role (notably Gemma). For those models a
// separate system message is silently dropped, so the instructions never reach
// the model. Detect them so we can fold the prompt into the first user turn.
export function supportsSystemRole(modelId: string | undefined): boolean {
  if (!modelId) return true
  return !/gemma/i.test(modelId)
}

// Prepend the system prompt to a user message's content, handling both plain
// text and multimodal (vision) content arrays.
export function foldSystemPrompt(
  content: string | ContentPart[],
  systemPrompt: string
): string | ContentPart[] {
  if (typeof content === 'string') {
    return `${systemPrompt}\n\n${content}`
  }
  const idx = content.findIndex((p) => p.type === 'text')
  if (idx >= 0) {
    const part = content[idx] as { type: 'text'; text: string }
    const next = [...content]
    next[idx] = { type: 'text', text: `${systemPrompt}\n\n${part.text}` }
    return next
  }
  return [{ type: 'text', text: systemPrompt }, ...content]
}

// Build the engine-facing chat history from transcript entries (no attachment
// augmentation — that's send-only, since attachments aren't reconstructed when
// regenerating/editing). Pushes the system prompt for models that support a
// system role, otherwise folds it into the first user turn.
export function buildHistory(
  entries: ChatEntry[],
  systemPrompt: string,
  modelId: string | undefined,
  // `send` uses this to inject attachments into the last (newest user) turn.
  // Applied before folding so a folded single-turn prompt isn't overwritten.
  transformLast?: (content: string | ContentPart[]) => string | ContentPart[]
): ChatMessage[] {
  const trimmedSystem = systemPrompt.trim()
  const modelSupportsSystem = supportsSystemRole(modelId)
  const chatHistory: ChatMessage[] = []
  if (trimmedSystem && modelSupportsSystem) {
    chatHistory.push({ role: 'system', content: trimmedSystem })
  }
  chatHistory.push(
    ...entries.slice(-20).map((e) => ({
      role: e.role as 'user' | 'assistant',
      content: e.content,
    }))
  )
  if (transformLast && chatHistory.length > 0) {
    const last = chatHistory[chatHistory.length - 1]
    last.content = transformLast(last.content)
  }
  if (trimmedSystem && !modelSupportsSystem) {
    const firstUser = chatHistory.find((m) => m.role === 'user')
    if (firstUser) firstUser.content = foldSystemPrompt(firstUser.content, trimmedSystem)
  }
  return chatHistory
}

// Lightweight attachment descriptor stored on a user turn so the chat shows what
// was attached. `dataUrl` (image thumbnail) is stripped before persisting to
// history to keep localStorage small.
export interface MessageAttachment {
  name: string
  mimeType: string
  kind: 'image' | 'file'
  /** Image preview (≤ ATTACHMENT_PERSIST_LIMIT) — shown in the bubble & persisted. */
  dataUrl?: string
  /** Text-file content (≤ ATTACHMENT_PERSIST_LIMIT) — viewable & persisted. */
  text?: string
}

// Cap how much per-attachment data we keep for display/history. Larger files
// keep only metadata (a name chip); larger images keep a downscaled preview.
export const ATTACHMENT_PERSIST_LIMIT = 32 * 1024 // 32 KB

export const byteLen = (s: string): number => new TextEncoder().encode(s).length

// Downscale an image data URL to a JPEG preview whose string length stays within
// `maxLen`. Returns undefined if it can't get under the cap.
async function makeImagePreview(srcDataUrl: string, maxLen = ATTACHMENT_PERSIST_LIMIT): Promise<string | undefined> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = reject
      im.src = srcDataUrl
    })
    const maxDim = 320
    let w = img.width || maxDim
    let h = img.height || maxDim
    if (w > maxDim || h > maxDim) {
      const r = Math.min(maxDim / w, maxDim / h)
      w = Math.max(1, Math.round(w * r))
      h = Math.max(1, Math.round(h * r))
    }
    for (const [dw, dh] of [[w, h], [Math.round(w / 1.5), Math.round(h / 1.5)], [Math.round(w / 2), Math.round(h / 2)]]) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, dw)
      canvas.height = Math.max(1, dh)
      const ctx = canvas.getContext('2d')
      if (!ctx) return undefined
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      for (const q of [0.6, 0.45, 0.3, 0.2]) {
        const out = canvas.toDataURL('image/jpeg', q)
        if (out.length <= maxLen) return out
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

export interface ChatEntry {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  streaming?: boolean
  /** Model that generated this assistant turn — so it stays correctly labelled
      even after the user switches models mid-conversation. */
  modelName?: string | null
  /** Files/images attached to a user turn, for display in the transcript. */
  attachments?: MessageAttachment[]
  /** Generation telemetry for an assistant turn (token/s shown under the bubble). */
  stats?: GenerationStats
}

export interface GenerationStats {
  /** Token count (approximated by streamed fragments). */
  tokenCount: number
  /** Wall-clock generation time, first token → last, in ms. */
  elapsedMs: number
  tokensPerSec: number
}

export interface Attachment {
  id: string
  name: string
  mimeType: string
  url: string
  size: number
  kind: 'image' | 'file'
  text?: string // extracted text content for non-image files
  dataUrl?: string // full base64 data URL for images (sent to vision models)
  previewUrl?: string // downscaled image preview (≤ limit) for display & history
}

// Snapshot a live Attachment down to what's shown in the transcript and persisted
// to history: images keep their downscaled preview; files keep their text only if
// it's within the persist limit, otherwise just a name chip (metadata) survives.
export function toDisplayAttachment(a: Attachment): MessageAttachment {
  if (a.kind === 'image') {
    return { name: a.name, mimeType: a.mimeType, kind: a.kind, dataUrl: a.previewUrl }
  }
  const text = a.text && byteLen(a.text) <= ATTACHMENT_PERSIST_LIMIT ? a.text : undefined
  return { name: a.name, mimeType: a.mimeType, kind: a.kind, text }
}

export function useChat() {
  const [messages, setMessages] = useState<ChatEntry[]>([])
  // The system prompt is per-conversation: `systemPrompt` is the working value
  // for the current chat (edited in the chat's settings modal, saved with the
  // conversation). `defaultSystemPrompt` is the persisted default that new chats
  // start from — edited only on the Settings page. Keeping them separate means
  // tweaking one chat never changes your default, and vice-versa.
  const [defaultSystemPrompt, setDefaultSystemPrompt] = usePersistentState(
    'wls:systemPrompt',
    DEFAULT_SYSTEM_PROMPT,
  )
  const [systemPrompt, setSystemPrompt] = useState(defaultSystemPrompt)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const abortRef = useRef(false)

  // Shared streaming core: consume the engine stream into the assistant message
  // identified by `assistantId`. Reused by send, regenerate, and editUserMessage.
  const streamInto = useCallback(
    async (chatHistory: ChatMessage[], assistantId: string, options?: GenerateOptions) => {
      try {
        const stream = engineManager.generateStream(chatHistory, {
          temperature: options?.temperature ?? 0.7,
          maxTokens: options?.maxTokens ?? 1024,
          topP: options?.topP,
          topK: options?.topK,
          frequencyPenalty: options?.frequencyPenalty,
          presencePenalty: options?.presencePenalty,
          seed: options?.seed,
          stop: options?.stop,
        })
        let fullContent = ''
        let tokenCount = 0
        let firstAt = 0
        for await (const token of stream) {
          if (abortRef.current) break
          if (firstAt === 0) firstAt = performance.now()
          tokenCount++
          fullContent += token
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: fullContent } : m))
          )
        }
        // Token/s measured from first token to last (excludes prompt processing).
        const elapsedMs = firstAt ? performance.now() - firstAt : 0
        const stats: GenerationStats | undefined =
          tokenCount > 0
            ? {
                tokenCount,
                elapsedMs: Math.round(elapsedMs),
                tokensPerSec: elapsedMs > 0 ? Math.round((tokenCount / (elapsedMs / 1000)) * 10) / 10 : 0,
              }
            : undefined
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, streaming: false, stats } : m))
        )
      } catch (err) {
        const message = String(err instanceof Error ? err.message : err)
        setError(message)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `[Error: ${message}]`, streaming: false }
              : m
          )
        )
      } finally {
        setIsGenerating(false)
      }
    },
    []
  )

  // Spawn a fresh streaming assistant placeholder labelled with the current model.
  const makeAssistantEntry = useCallback((): ChatEntry => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-a`,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    streaming: true,
    modelName: engineManager.getLoadedModel()?.name ?? null,
  }), [])

  const send = useCallback(
    async (userText: string, options?: GenerateOptions) => {
      if (!userText.trim() || isGenerating) return
      if (!engineManager.isLoaded()) {
        setError('No model is loaded. Please load a model from the Models page.')
        return
      }

      setError(null)
      abortRef.current = false

      // Snapshot attachments for display in the user's bubble (the model gets the
      // full content separately, below). Only keep within the persist limit: a
      // downscaled image preview, or small-file text; larger ones keep just a name.
      const displayAttachments: MessageAttachment[] = attachments.map(toDisplayAttachment)

      const userEntry: ChatEntry = {
        id: `${Date.now()}-u`,
        role: 'user',
        content: userText.trim(),
        timestamp: Date.now(),
        ...(displayAttachments.length > 0 ? { attachments: displayAttachments } : {}),
      }

      const assistantEntry = makeAssistantEntry()
      const assistantId = assistantEntry.id

      setMessages((prev) => [...prev, userEntry, assistantEntry])
      setAttachments([]) // Clear attachments after sending
      setIsGenerating(true)

      // Augment the model's copy of this turn with attachments — the displayed
      // user bubble keeps the clean typed text. File text is injected inline;
      // images are sent as multimodal parts, but only to a vision model.
      let augmentedText = userText.trim()
      const fileAtts = attachments.filter((a) => a.kind === 'file' && a.text)
      if (fileAtts.length > 0) {
        const ctx = fileAtts
          .map((a) => `--- Attached file: ${a.name} ---\n${a.text}`)
          .join('\n\n')
        augmentedText = `${ctx}\n\n${userText.trim()}`
      }

      const supportsVision = engineManager.getLoadedModel()?.supportsVision === true
      const imageAtts = supportsVision
        ? attachments.filter((a) => a.kind === 'image' && a.dataUrl)
        : []

      // buildHistory pushes the system message, trims to the last 20 turns, and
      // folds the system prompt for system-less models. `transformLast` injects
      // this turn's attachments before that fold so a single-turn prompt survives.
      const chatHistory = buildHistory(
        [...messages, userEntry],
        systemPrompt,
        engineManager.getLoadedModel()?.modelId,
        () =>
          imageAtts.length > 0
            ? [
                { type: 'text', text: augmentedText },
                ...imageAtts.map(
                  (a): ContentPart => ({ type: 'image_url', image_url: { url: a.dataUrl! } })
                ),
              ]
            : augmentedText
      )

      await streamInto(chatHistory, assistantId, options)
    },
    [messages, systemPrompt, isGenerating, attachments, makeAssistantEntry, streamInto]
  )

  // Regenerate the assistant reply at `assistantId`: drop it (and anything after),
  // then re-run the user turn that preceded it. Uses the visible transcript only —
  // original attachments (full-res image / large file text) aren't reconstructed.
  const regenerate = useCallback(
    async (assistantId: string, options?: GenerateOptions) => {
      if (isGenerating || !engineManager.isLoaded()) return
      const idx = messages.findIndex((m) => m.id === assistantId && m.role === 'assistant')
      if (idx < 0) return
      const prefix = messages.slice(0, idx) // up to and including the preceding user turn
      if (!prefix.some((m) => m.role === 'user')) return

      setError(null)
      abortRef.current = false
      const assistantEntry = makeAssistantEntry()
      setMessages([...prefix, assistantEntry])

      setIsGenerating(true)
      const chatHistory = buildHistory(prefix, systemPrompt, engineManager.getLoadedModel()?.modelId)
      await streamInto(chatHistory, assistantEntry.id, options)
    },
    [messages, systemPrompt, isGenerating, makeAssistantEntry, streamInto]
  )

  // Edit a user turn's text, drop everything after it, and regenerate the reply.
  const editUserMessage = useCallback(
    async (userId: string, newText: string, options?: GenerateOptions) => {
      const text = newText.trim()
      if (!text || isGenerating || !engineManager.isLoaded()) return
      const idx = messages.findIndex((m) => m.id === userId && m.role === 'user')
      if (idx < 0) return

      setError(null)
      abortRef.current = false

      const editedUser: ChatEntry = { ...messages[idx], content: text, timestamp: Date.now() }
      const prefix = [...messages.slice(0, idx), editedUser]
      const assistantEntry = makeAssistantEntry()
      setMessages([...prefix, assistantEntry])

      setIsGenerating(true)
      const chatHistory = buildHistory(prefix, systemPrompt, engineManager.getLoadedModel()?.modelId)
      await streamInto(chatHistory, assistantEntry.id, options)
    },
    [messages, systemPrompt, isGenerating, makeAssistantEntry, streamInto]
  )

  const stop = useCallback(() => {
    abortRef.current = true
    engineManager.stop()
    setIsGenerating(false)
  }, [])

  const clearChat = useCallback(() => {
    setMessages([])
    setError(null)
    setAttachments([])
    // A new chat starts from the default prompt, not whatever the last chat used.
    setSystemPrompt(defaultSystemPrompt)
  }, [defaultSystemPrompt])

  const loadConversation = useCallback((msgs: ChatEntry[], sysPrompt: string) => {
    setMessages(msgs)
    // Restore the conversation's own prompt without touching the default.
    setSystemPrompt(sysPrompt)
    setError(null)
    setAttachments([])
  }, [])

  const addAttachment = useCallback((file: File) => {
    const isImage = file.type.startsWith('image/')
    const id = `att-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const att: Attachment = {
      id,
      name: file.name,
      mimeType: file.type,
      url: URL.createObjectURL(file),
      size: file.size,
      kind: isImage ? 'image' : 'file',
    }
    setAttachments((prev) => [...prev, att])

    if (isImage) {
      // Read as a base64 data URL so it can be sent to a vision model.
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const dataUrl = reader.result
          setAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, dataUrl } : a))
          )
          // Build a small preview (for the bubble + history) off the main thread.
          makeImagePreview(dataUrl).then((previewUrl) => {
            if (previewUrl) {
              setAttachments((prev) =>
                prev.map((a) => (a.id === id ? { ...a, previewUrl } : a))
              )
            }
          })
        }
      }
      reader.readAsDataURL(file)
    } else {
      // Non-image files: extract text so it can be injected into the prompt.
      // PDFs go through pdf.js (lazy-loaded); everything else reads as plain text.
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
      const readText = isPdf
        ? import('../utils/pdfText').then((m) => m.extractPdfText(file))
        : file.text()
      readText
        .then((text) =>
          setAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, text } : a))
          )
        )
        .catch(() => { /* unreadable / scanned PDF — keep as a named attachment only */ })
    }
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id)
      if (att) URL.revokeObjectURL(att.url)
      return prev.filter((a) => a.id !== id)
    })
  }, [])

  return {
    messages,
    systemPrompt,
    setSystemPrompt,
    defaultSystemPrompt,
    setDefaultSystemPrompt,
    isGenerating,
    error,
    send,
    regenerate,
    editUserMessage,
    stop,
    clearChat,
    loadConversation,
    attachments,
    addAttachment,
    removeAttachment,
  }
}
