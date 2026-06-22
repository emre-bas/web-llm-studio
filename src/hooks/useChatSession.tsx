import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useChat, DEFAULT_SYSTEM_PROMPT } from './useChat'
import { usePersistentState } from './usePersistentState'
import { useChatHistory, DEFAULT_ADVANCED_PARAMS, type SavedConversation, type AdvancedParams } from './useChatHistory'
import { useEngine } from './useEngine'
import type { ExportEnvelope } from '../utils/conversationIO'

// Default generation params — exported alongside DEFAULT_SYSTEM_PROMPT so the
// reset action and the persisted-state initialisers share one source of truth.
export const DEFAULT_TEMPERATURE = 0.7
export const DEFAULT_MAX_TOKENS = 1024

// The chat session (messages, system prompt, generation settings, active
// conversation) lives here — provided ABOVE the router Outlet (in Layout) so it
// survives navigating to Models/Settings and back. ChatPage holds only view
// state (input draft, panel toggles). Because the provider never unmounts on
// route change, a generation that finishes while you're on another page is still
// captured and auto-saved.
type ChatSession = Omit<ReturnType<typeof useChat>, 'loadConversation'> & {
  activeConvId: string | null
  setActiveConvId: (id: string | null) => void
  // Working values for the current conversation (edited in the chat modal).
  temperature: number
  setTemperature: (v: number) => void
  maxTokens: number
  setMaxTokens: (v: number) => void
  advancedParams: AdvancedParams
  setAdvancedParams: (v: AdvancedParams) => void
  // Persisted defaults for new chats (edited on the Settings page).
  defaultTemperature: number
  setDefaultTemperature: (v: number) => void
  defaultMaxTokens: number
  setDefaultMaxTokens: (v: number) => void
  defaultAdvancedParams: AdvancedParams
  setDefaultAdvancedParams: (v: AdvancedParams) => void
  // Settings are per-conversation, so loading restores the whole record's
  // settings (prompt + params) rather than just messages + prompt.
  loadConversation: (conv: SavedConversation) => void
  resetChatSettings: () => void
  conversations: SavedConversation[]
  removeConv: (id: string) => void
  clearAllConvs: () => void
  exportConversations: (ids?: string[]) => ExportEnvelope
  importConversations: (raw: unknown) => number
}

const ChatSessionContext = createContext<ChatSession | null>(null)

export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const chat = useChat()
  const {
    conversations,
    save: saveConv,
    remove: removeConvFromHistory,
    clearAll: clearAllConvsFromHistory,
    exportConversations,
    importConversations,
  } = useChatHistory()
  const { loadedModel } = useEngine()

  const [activeConvId, setActiveConvId] = useState<string | null>(null)

  // Generation params mirror the system prompt: working values for the current
  // chat (edited in the chat settings modal) plus persisted defaults for new
  // chats (edited on the Settings page). The two are independent — editing one
  // chat never moves your defaults.
  const [defaultTemperature, setDefaultTemperature] = usePersistentState('wls:temperature', DEFAULT_TEMPERATURE)
  const [defaultMaxTokens, setDefaultMaxTokens] = usePersistentState('wls:maxTokens', DEFAULT_MAX_TOKENS)
  const [defaultAdvancedParams, setDefaultAdvancedParams] = usePersistentState<AdvancedParams>(
    'wls:advancedParams',
    DEFAULT_ADVANCED_PARAMS,
  )
  const [temperature, setTemperature] = useState(defaultTemperature)
  const [maxTokens, setMaxTokens] = useState(defaultMaxTokens)
  const [advancedParams, setAdvancedParams] = useState(defaultAdvancedParams)

  const {
    messages,
    systemPrompt,
    loadConversation: loadChat,
    clearChat: clearChatMessages,
    setDefaultSystemPrompt,
  } = chat

  // New chat: reset the working generation params to the defaults (useChat
  // already resets the working system prompt inside clearChat).
  const clearChat = useCallback(() => {
    clearChatMessages()
    setTemperature(defaultTemperature)
    setMaxTokens(defaultMaxTokens)
    setAdvancedParams(defaultAdvancedParams)
  }, [clearChatMessages, defaultTemperature, defaultMaxTokens, defaultAdvancedParams])

  // Deleting the conversation that's currently open must also close it —
  // otherwise the chat view keeps showing a record that no longer exists in
  // history (and the next auto-save would silently resurrect it). Clearing the
  // chat resets messages + working settings and frees the active id.
  const removeConv = useCallback(
    (id: string) => {
      removeConvFromHistory(id)
      if (id === activeConvId) {
        clearChat()
        setActiveConvId(null)
      }
    },
    [removeConvFromHistory, activeConvId, clearChat],
  )

  // Clearing all history likewise closes whatever is open.
  const clearAllConvs = useCallback(() => {
    clearAllConvsFromHistory()
    clearChat()
    setActiveConvId(null)
  }, [clearAllConvsFromHistory, clearChat])

  // Load a saved conversation, restoring its own settings. Records that predate
  // per-conversation params fall back to the current defaults.
  const loadConversation = useCallback(
    (conv: SavedConversation) => {
      loadChat(conv.messages, conv.systemPrompt)
      setTemperature(conv.temperature ?? defaultTemperature)
      setMaxTokens(conv.maxTokens ?? defaultMaxTokens)
      setAdvancedParams(conv.advancedParams ?? defaultAdvancedParams)
    },
    [loadChat, defaultTemperature, defaultMaxTokens, defaultAdvancedParams],
  )

  // Restore the new-chat defaults to factory values (the Settings-page reset).
  // The current conversation keeps its own settings — it's a saved artifact.
  const resetChatSettings = useCallback(() => {
    setDefaultSystemPrompt(DEFAULT_SYSTEM_PROMPT)
    setDefaultTemperature(DEFAULT_TEMPERATURE)
    setDefaultMaxTokens(DEFAULT_MAX_TOKENS)
    setDefaultAdvancedParams(DEFAULT_ADVANCED_PARAMS)
  }, [setDefaultSystemPrompt, setDefaultTemperature, setDefaultMaxTokens, setDefaultAdvancedParams])

  // Auto-save the active conversation whenever it settles (not mid-stream).
  useEffect(() => {
    if (messages.length === 0) return
    if (messages.some((m) => m.streaming)) return

    const convId = activeConvId ?? Date.now().toString()
    const title =
      messages.find((m) => m.role === 'user')?.content.trim().slice(0, 60) || 'Conversation'

    saveConv({
      id: convId,
      title,
      modelId: loadedModel?.id ?? null,
      modelName: loadedModel?.name ?? null,
      createdAt: messages[0].timestamp,
      // Use the last message's own timestamp, not Date.now(): this effect also
      // fires when an existing conversation is *loaded* from history (that resets
      // `messages`), and Date.now() would re-stamp every opened chat as "just
      // now". The last message's timestamp reflects real activity instead.
      updatedAt: messages[messages.length - 1].timestamp,
      systemPrompt,
      temperature,
      maxTokens,
      advancedParams,
      // Attachments are already capped to ATTACHMENT_PERSIST_LIMIT at send time
      // (image preview / small-file text), so they're safe to persist as-is.
      messages,
    })
    setActiveConvId((prev) => prev ?? convId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  const value: ChatSession = {
    ...chat,
    // Override useChat's clearChat / loadConversation with the session versions
    // that also handle the per-conversation generation params.
    clearChat,
    loadConversation,
    activeConvId,
    setActiveConvId,
    temperature,
    setTemperature,
    maxTokens,
    setMaxTokens,
    advancedParams,
    setAdvancedParams,
    defaultTemperature,
    setDefaultTemperature,
    defaultMaxTokens,
    setDefaultMaxTokens,
    defaultAdvancedParams,
    setDefaultAdvancedParams,
    resetChatSettings,
    conversations,
    removeConv,
    clearAllConvs,
    exportConversations,
    importConversations,
  }

  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>
}

// Colocated with the provider on purpose; the hook export trips react-refresh's
// "only export components" rule, which doesn't apply to a context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useChatSession(): ChatSession {
  const ctx = useContext(ChatSessionContext)
  if (!ctx) throw new Error('useChatSession must be used within a ChatSessionProvider')
  return ctx
}
