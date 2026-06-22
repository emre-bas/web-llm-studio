import type { SavedConversation } from '../hooks/useChatHistory'

// Bump when the on-disk export shape changes in a way importers must migrate.
export const EXPORT_SCHEMA = 1
const APP_TAG = 'web-llm-studio'

// A self-contained, versioned export envelope. The schema + app version let a
// future import migrate older files; conversations are embedded whole (messages
// already carry capped attachments, so the file is reproducible offline).
export interface ExportEnvelope {
  app: typeof APP_TAG
  schema: number
  appVersion: string
  exportedAt: number
  conversations: SavedConversation[]
}

export function buildExport(conversations: SavedConversation[], appVersion = '0'): ExportEnvelope {
  return {
    app: APP_TAG,
    schema: EXPORT_SCHEMA,
    appVersion,
    exportedAt: Date.now(),
    conversations,
  }
}

// Minimal shape guard for a single conversation — mirrors useChatHistory's
// resilient parse: anything that isn't clearly a conversation is skipped rather
// than throwing, so one bad record doesn't fail the whole import.
function isConversation(v: unknown): v is SavedConversation {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return typeof c.title === 'string' && Array.isArray(c.messages)
}

let importCounter = 0
function freshId(): string {
  // Regenerate ids on import so an imported chat never clobbers an existing one.
  return `imp-${Date.now()}-${(importCounter++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

// Parse either a full envelope or a bare array of conversations (lenient). Each
// imported conversation gets a fresh id; unknown/old fields are tolerated.
export function parseImport(raw: unknown): SavedConversation[] {
  let list: unknown
  if (Array.isArray(raw)) {
    list = raw
  } else if (raw && typeof raw === 'object' && Array.isArray((raw as ExportEnvelope).conversations)) {
    list = (raw as ExportEnvelope).conversations
  } else {
    throw new Error('Not a recognised conversation export file.')
  }

  const valid = (list as unknown[]).filter(isConversation)
  if (valid.length === 0) {
    throw new Error('No valid conversations found in the file.')
  }

  return valid.map((c) => ({
    ...c,
    id: freshId(),
    title: c.title || 'Imported conversation',
    modelId: c.modelId ?? null,
    modelName: c.modelName ?? null,
    createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
    updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
    systemPrompt: typeof c.systemPrompt === 'string' ? c.systemPrompt : '',
    messages: Array.isArray(c.messages) ? c.messages : [],
  }))
}

// Parse raw JSON text into conversations, surfacing a friendly error on bad JSON.
export function parseImportText(text: string): SavedConversation[] {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON.')
  }
  return parseImport(json)
}
