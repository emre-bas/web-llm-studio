import { useState, useCallback } from 'react'
import type { ChatEntry } from './useChat'
import type { GenerateOptions } from '../engines/base'
import { buildExport, parseImport, type ExportEnvelope } from '../utils/conversationIO'

// Injected by Vite's `define` at build time (see vite.config.ts); `typeof` keeps
// it safe in any context where the replacement didn't run.
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0'

const STORAGE_KEY = 'wls:convs'
const MAX_CONVERSATIONS = 100

// Advanced sampling params, grouped into one object so the per-conversation +
// persisted-default plumbing stays a single value rather than ~12 flat fields.
// Mirrors (a subset of) GenerateOptions in engines/base.ts.
export interface AdvancedParams {
  topP: number
  topK: number
  frequencyPenalty: number
  presencePenalty: number
  /** null = random each run; a number = deterministic. */
  seed: number | null
  stop: string[]
}

export const DEFAULT_ADVANCED_PARAMS: AdvancedParams = {
  topP: 0.95,
  topK: 40,
  frequencyPenalty: 0,
  presencePenalty: 0,
  seed: null,
  stop: [],
}

// Convert the UI-facing AdvancedParams into engine GenerateOptions: a null seed
// means "random" (omit it), and an empty stop list is dropped so the engine
// keeps its own defaults.
export function advancedToOptions(p: AdvancedParams): Partial<GenerateOptions> {
  return {
    topP: p.topP,
    topK: p.topK,
    frequencyPenalty: p.frequencyPenalty,
    presencePenalty: p.presencePenalty,
    seed: p.seed ?? undefined,
    stop: p.stop.length > 0 ? p.stop : undefined,
  }
}

export interface SavedConversation {
  id: string
  title: string
  modelId: string | null
  modelName: string | null
  createdAt: number
  updatedAt: number
  systemPrompt: string
  // Per-conversation generation params. Optional so conversations saved before
  // these were tracked still load (they fall back to the current defaults).
  temperature?: number
  maxTokens?: number
  advancedParams?: AdvancedParams
  messages: ChatEntry[]
}

function loadAll(): SavedConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist(convs: SavedConversation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(convs))
  } catch {
    // Quota exceeded — keep most recent 30
    const trimmed = convs.slice(0, 30)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed)) } catch { /* give up */ }
  }
}

// Insert or update a conversation by id: an existing id is replaced in place; a
// new one is prepended and the list capped at MAX_CONVERSATIONS, then the result
// is sorted newest-first. (Cap is applied before the sort, matching the original
// behaviour — the list is kept updatedAt-sorted on every save, so the dropped
// entry is the oldest.) Pure, so it's unit-testable.
export function upsertConversation(
  prev: SavedConversation[],
  conv: SavedConversation,
): SavedConversation[] {
  const idx = prev.findIndex((c) => c.id === conv.id)
  const next =
    idx >= 0
      ? prev.map((c) => (c.id === conv.id ? conv : c))
      : [conv, ...prev].slice(0, MAX_CONVERSATIONS)
  return [...next].sort((a, b) => b.updatedAt - a.updatedAt)
}

// Merge freshly-imported conversations ahead of the existing ones, cap at
// MAX_CONVERSATIONS, and sort newest-first. Pure, so it's unit-testable.
export function mergeImported(
  prev: SavedConversation[],
  imported: SavedConversation[],
): SavedConversation[] {
  return [...imported, ...prev]
    .slice(0, MAX_CONVERSATIONS)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function useChatHistory() {
  const [conversations, setConversations] = useState<SavedConversation[]>(loadAll)

  const save = useCallback((conv: SavedConversation) => {
    setConversations((prev) => {
      const next = upsertConversation(prev, conv)
      persist(next)
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id)
      persist(next)
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setConversations([])
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  // Build a versioned export envelope for all conversations, or a subset by id.
  const exportConversations = useCallback(
    (ids?: string[]): ExportEnvelope => {
      const subset = ids ? conversations.filter((c) => ids.includes(c.id)) : conversations
      return buildExport(subset, APP_VERSION)
    },
    [conversations],
  )

  // Import conversations from a parsed file/envelope; ids are regenerated so
  // nothing is overwritten. Returns how many were added. Throws on a bad file.
  const importConversations = useCallback((raw: unknown): number => {
    const imported = parseImport(raw)
    setConversations((prev) => {
      const next = mergeImported(prev, imported)
      persist(next)
      return next
    })
    return imported.length
  }, [])

  return { conversations, save, remove, clearAll, exportConversations, importConversations }
}
