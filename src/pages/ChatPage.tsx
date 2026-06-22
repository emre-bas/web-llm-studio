import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEngine } from '../hooks/useEngine'
import { useRecommendedModels } from '../hooks/useRecommendedModel'
import { useCachedModels } from '../hooks/useCachedModels'
import { useChatSession } from '../hooks/useChatSession'
import { useWebGpu, type WebGpuInfo } from '../hooks/useWebGpu'
import { advancedToOptions, type SavedConversation } from '../hooks/useChatHistory'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { Progress } from '../components/ui/Progress'
import { Modal } from '../components/ui/Modal'
import { ModelDownloadDialog } from '../components/chat/ModelDownloadDialog'
import { AdvancedParamsEditor } from '../components/chat/AdvancedParamsEditor'
import { useNavDrawer } from '../components/layout/navDrawer'
import { useSpeech } from '../hooks/useSpeech'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { useAppStore } from '../stores/appStore'
import { formatMB } from '../utils/formatBytes'
import { estimateConversationTokens } from '../utils/tokenEstimate'
import { classifyLoadError } from '../utils/loadError'
import type { ModelEntry } from '../catalog/types'
import styles from './ChatPage.module.css'

// Markdown rendering (react-markdown + remark-gfm + highlight.js) lives in its
// own chunk to keep the chat landing/welcome screen lean. It's lazy-loaded, but
// preloaded once a model is ready (see ChatPage) so the first streamed reply
// renders markdown immediately instead of briefly flashing as plain text.
const importMarkdown = () => import('../components/chat/MarkdownMessage')
const MarkdownMessage = lazy(() =>
  importMarkdown().then((m) => ({ default: m.MarkdownMessage }))
)

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function formatConvDate(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'Yesterday'
  if (days < 7) return new Date(ts).toLocaleDateString([], { weekday: 'short' })
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function getDateGroup(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'This week'
  if (days < 30) return 'This month'
  return 'Older'
}

function groupConversations(convs: SavedConversation[]) {
  const groups = new Map<string, SavedConversation[]>()
  const order: string[] = []
  for (const conv of convs) {
    const label = getDateGroup(conv.updatedAt)
    if (!groups.has(label)) { groups.set(label, []); order.push(label) }
    groups.get(label)!.push(conv)
  }
  return order.map((label) => ({ label, items: groups.get(label)! }))
}

/* ── Download ETA ────────────────────────────────────────────────────────── */
function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem ? `${m}m ${rem}s` : `${m}m`
}

// Rough "time left" for a download, derived from elapsed time and percent done.
// Engine-agnostic (works for both WebLLM's fraction and Wllama's byte progress).
// Suppressed below 4% (estimate is wildly noisy at the very start) and at 100%.
function useDownloadEta(active: boolean, progress: number): string | null {
  const startRef = useRef<number | null>(null)
  const [eta, setEta] = useState<string | null>(null)

  useEffect(() => {
    if (!active) {
      startRef.current = null
      setEta(null)
      return
    }
    if (startRef.current === null) startRef.current = Date.now()
    if (progress < 4 || progress >= 100) {
      setEta(null)
      return
    }
    const elapsed = Date.now() - startRef.current
    setEta(formatDuration((elapsed / progress) * (100 - progress)))
  }, [active, progress])

  return eta
}

/* ── Context-usage meter ─────────────────────────────────────────────────── */
function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

// Generation wall-clock for the stats line — sub-minute shows one decimal second
// (e.g. "1.5s"), longer falls back to "Xm Ys".
function formatGenTime(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

// Shows the conversation's estimated token footprint against the model's context
// window — making the otherwise-silent history truncation visible. Token count is
// a heuristic (see tokenEstimate.ts), so it's labelled with a "~".
function ContextMeter({ used, total }: { used: number; total: number }) {
  const pct = Math.min(100, Math.round((used / total) * 100))
  const warn = pct >= 80
  return (
    <div
      className={styles.ctxMeter}
      title={`Estimated context usage: ~${used} of ${total} tokens (${pct}%)`}
    >
      <div className={styles.ctxBar}>
        <div
          className={`${styles.ctxFill} ${warn ? styles.ctxFillWarn : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={styles.ctxLabel}>~{formatTokens(used)} / {formatTokens(total)} ctx</span>
    </div>
  )
}

/* ── Copy button ─────────────────────────────────────────────────────────── */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])
  return (
    <button className={styles.copyBtn} onClick={copy} title="Copy message" aria-label="Copy message">
      {copied ? '✓' : '⧉'}
    </button>
  )
}

/* ── Chat History Panel ──────────────────────────────────────────────────── */
function ChatHistoryPanel({
  open,
  conversations,
  activeId,
  onClose,
  onSelect,
  onDelete,
  onClearAll,
  onNewChat,
  onImport,
  onExportAll,
  onExportOne,
  canOpen,
}: {
  open: boolean
  conversations: SavedConversation[]
  activeId: string | null
  onClose: () => void
  onSelect: (conv: SavedConversation) => void
  onDelete: (id: string) => void
  onClearAll: () => void
  onNewChat: () => void
  onImport: () => void
  onExportAll: () => void
  onExportOne: (id: string, title: string) => void
  /** Whether a conversation can be opened (a model must be loaded first). */
  canOpen: boolean
}) {
  const groups = groupConversations(conversations)

  // Single-delete is destructive and the active chat closes with it, so confirm
  // first — mirroring the "Clear all" guard. Include the title for clarity.
  const confirmDelete = (conv: SavedConversation) => {
    if (window.confirm(`Delete "${conv.title}"?`)) onDelete(conv.id)
  }

  if (!open) return null

  return (
    <>
      <div className={styles.historyBackdrop} onClick={onClose} aria-hidden="true" />
      <div className={styles.historyPanel} role="dialog" aria-label="Chat history">
        <div className={styles.historyHeader}>
          <span className={styles.historyTitle}>History</span>
          <div className={styles.historyHeaderActions}>
            <button className={styles.historyClearAll} onClick={onImport} title="Import conversations from a file">
              Import
            </button>
            {conversations.length > 0 && (
              <button className={styles.historyClearAll} onClick={onExportAll} title="Export all conversations to a file">
                Export
              </button>
            )}
            {conversations.length > 0 && (
              <button
                className={styles.historyClearAll}
                onClick={() => { if (window.confirm('Delete all conversations?')) onClearAll() }}
              >
                Clear all
              </button>
            )}
            <button className={styles.historyClose} onClick={onClose} aria-label="Close history">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        <div className={styles.historyContent}>
          <button className={styles.newChatBtn} onClick={onNewChat}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            New chat
          </button>

          {!canOpen && conversations.length > 0 && (
            <div className={styles.historyNotice} role="note">
              <span aria-hidden="true">💡</span>
              Load a model first to open a conversation.
            </div>
          )}

          {conversations.length === 0 ? (
            <div className={styles.historyEmpty}>
              <span className={styles.historyEmptyIcon} aria-hidden="true">💬</span>
              <p>No conversations yet.</p>
              <p>Start chatting and your history will appear here.</p>
            </div>
          ) : (
            groups.map(({ label, items }) => (
              <div key={label} className={styles.historyGroup}>
                <div className={styles.historyGroupLabel}>{label}</div>
                {items.map((conv) => (
                  <button
                    key={conv.id}
                    className={`${styles.historyItem} ${activeId === conv.id ? styles.historyItemActive : ''} ${!canOpen ? styles.historyItemLocked : ''}`}
                    onClick={() => onSelect(conv)}
                    aria-disabled={!canOpen}
                    title={canOpen ? undefined : 'Load a model first to open this conversation'}
                  >
                    <div className={styles.historyItemContent}>
                      <div className={styles.historyItemTitle}>{conv.title}</div>
                      <div className={styles.historyItemMeta}>
                        {conv.modelName && (
                          <span>{conv.modelName.split(' ').slice(0, 2).join(' ')}</span>
                        )}
                        {conv.modelName && <span className={styles.historyDot}>·</span>}
                        <span>{formatConvDate(conv.updatedAt)}</span>
                      </div>
                    </div>
                    <span
                      className={styles.historyExportBtn}
                      role="button"
                      aria-label="Export conversation"
                      title="Export this conversation"
                      onClick={(e) => { e.stopPropagation(); onExportOne(conv.id, conv.title) }}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), onExportOne(conv.id, conv.title))}
                    >
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                        <path d="M7 1v8M4 6l3 3 3-3M2 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                    <span
                      className={styles.historyDeleteBtn}
                      role="button"
                      aria-label="Delete conversation"
                      onClick={(e) => { e.stopPropagation(); confirmDelete(conv) }}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), confirmDelete(conv))}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                      </svg>
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}

/* ── Status bar pill ─────────────────────────────────────────────────────── */
function StatusBar({
  onToggleHistory,
  canNewChat,
  onNewChat,
}: {
  onToggleHistory: () => void
  canNewChat: boolean
  onNewChat: () => void
}) {
  const { setOpen: setNavOpen } = useNavDrawer()

  return (
    <div className={styles.statusBar}>
      <button
        className={styles.navToggleBtn}
        onClick={() => setNavOpen(true)}
        title="Menu"
        aria-label="Open navigation"
      >
        <span /><span /><span />
      </button>

      <div className={styles.statusRight}>
        <button
          className={styles.toolBtn}
          onClick={onNewChat}
          disabled={!canNewChat}
          title="New chat"
          aria-label="New chat"
        >
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          <span className={styles.toolBtnLabel}>New Chat</span>
        </button>

        {/* History is last so it sits at the right edge — the panel it opens
            slides in from the right, so the trigger lines up with it. */}
        <button
          className={styles.toolBtn}
          onClick={onToggleHistory}
          title="Chat history"
          aria-label="Chat history"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M8 4.5V8l2.5 1.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className={styles.toolBtnLabel}>History</span>
        </button>
      </div>
    </div>
  )
}

/* ── Empty state when no model is loaded ────────────────────────────────── */
function ChatWelcome({
  onLoad,
  loadingId,
  webgpu,
}: {
  onLoad: (model: ModelEntry, cached: boolean) => void
  loadingId: string | null
  webgpu: WebGpuInfo
}) {
  const recommended = useRecommendedModels()
  const { cachedIds } = useCachedModels(recommended)
  const navigate = useNavigate()
  const [index, setIndex] = useState(0)
  const [showDetails, setShowDetails] = useState(false)

  const count = recommended.length
  const current = count > 0 ? recommended[Math.min(index, count - 1)] : null
  const currentCached = current ? cachedIds.has(current.id) : false

  const go = (delta: number) => {
    setIndex((i) => Math.min(Math.max(i + delta, 0), count - 1))
    setShowDetails(false)
  }

  return (
    <div className={styles.welcome}>
      <h1 className={styles.welcomeTitle}>
        <span className={styles.titleLine}>Web LLM Studio<span className={styles.titleDash}> —</span></span>{' '}
        <span className={styles.titleLine}>Run local AI in your browser</span>
      </h1>
      <p className={styles.welcomeSubtitle}>Choose a model and start chatting.</p>

      {!webgpu.checking && !webgpu.supported && (
        <div className={styles.gpuWarn} role="alert">
          <span className={styles.gpuWarnIcon} aria-hidden="true">⚠️</span>
          <div className={styles.gpuWarnText}>
            <strong>WebGPU isn’t available in this browser.</strong>
            <span>
              The recommended models below run on the GPU and need it. Try Chrome or
              Edge with hardware acceleration enabled.{' '}
              <button className={styles.gpuWarnLink} onClick={() => navigate('/dashboard')}>
                Check compatibility
              </button>
            </span>
          </div>
        </div>
      )}

      {current && (
        <div className={styles.carouselWrap}>
          <div className={styles.carousel}>
            <button
              type="button"
              className={styles.carouselArrow}
              onClick={() => go(-1)}
              disabled={index <= 0}
              aria-label="Previous model"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <div className={styles.recommendedCard}>
              <span className={styles.recommendedLabel}>Recommended Starter Model</span>
              <div className={styles.recommendedName}>
                {current.name} <span className={styles.recommendedSize}>({current.sizeLabel})</span>
              </div>
              <div className={styles.recommendedActions}>
                <Button
                  variant="primary"
                  size="sm"
                  loading={loadingId === current.id}
                  onClick={() => onLoad(current, currentCached)}
                >
                  {loadingId === current.id ? 'Loading…' : currentCached ? 'Load Model' : 'Download & Load'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDetails((v) => !v)}
                  aria-expanded={showDetails}
                >
                  Details
                </Button>
              </div>
              {showDetails && (
                <div className={styles.recommendedMeta}>
                  <span>{current.parameterSize} · {current.sizeLabel} download · {formatMB(current.estimatedVram)} VRAM</span>
                  <span className={styles.recommendedDesc}>{current.description}</span>
                </div>
              )}
            </div>

            <button
              type="button"
              className={styles.carouselArrow}
              onClick={() => go(1)}
              disabled={index >= count - 1}
              aria-label="Next model"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {count > 1 && (
            <div className={styles.carouselDots} aria-hidden="true">
              {recommended.map((m, i) => (
                <span
                  key={m.id}
                  className={i === index ? styles.carouselDotActive : styles.carouselDot}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className={styles.welcomeActions}>
        <Button variant="primary" size="md" onClick={() => navigate('/models')}>
          Browse all models
        </Button>
        <Button variant="ghost" size="md" onClick={() => navigate('/dashboard')}>
          Check browser compatibility
        </Button>
      </div>

      <div className={styles.welcomeFeatures}>
        {[
          { icon: '🔒', label: 'Private', desc: 'Everything stays on your device locally' },
          { icon: '🆓', label: 'Free', desc: 'No account · No payment · No limits' },
          { icon: '⚡', label: 'Powerful', desc: 'GPU-accelerated via WebGPU' },
          { icon: '🌐', label: 'Accessible', desc: 'Install-free · Cross-platform · PWA' },
          { icon: '🚀', label: 'Instant', desc: 'Cacheable models, offline-ready' },
          { icon: '🎛️', label: 'Flexible', desc: 'Many models, vision support, fully tunable' },
          { icon: '🐙', label: 'Open', desc: "Excellent because it's Open-Source" },
        ].map((f) => (
          <div key={f.label} className={styles.featurePill}>
            <span className={styles.featureHead}>
              <span aria-hidden="true">{f.icon}</span>
              <span className={styles.featureLabel}>{f.label}</span>
            </span>
            <span className={styles.featureDesc}>{f.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Empty state when model is ready but no messages ────────────────────── */
function ChatReady({ modelName, onSuggestion }: { modelName: string; onSuggestion: (text: string) => void }) {
  const SUGGESTIONS = [
    'Explain how transformers work in simple terms.',
    'Write a short Python function to read a CSV file.',
    'What are the pros and cons of local AI inference?',
    'Summarize the main ideas behind large language models.',
  ]

  return (
    <div className={styles.readyState}>
      <div className={styles.readyIcon} aria-hidden="true">💬</div>
      <h2 className={styles.readyTitle}>{modelName} is ready</h2>
      <p className={styles.readySubtitle}>Ask anything — responses are generated locally in your browser.</p>
      <div className={styles.suggestions}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            className={styles.suggestion}
            onClick={() => onSuggestion(s)}
            type="button"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ── Recovery state when a model fails to load ──────────────────────────── */
function ChatLoadError({
  error,
  modelName,
  onRetry,
  onDismiss,
}: {
  error: string
  modelName?: string
  onRetry?: () => void
  onDismiss: () => void
}) {
  const navigate = useNavigate()
  const { title, hint } = classifyLoadError(error)

  return (
    <div className={styles.loadError}>
      <div className={styles.loadErrorIcon} aria-hidden="true">⚠️</div>
      <h2 className={styles.loadErrorTitle}>{title}</h2>
      <p className={styles.loadErrorHint}>{hint}</p>
      {error && <pre className={styles.loadErrorDetail}>{error}</pre>}
      <div className={styles.loadErrorActions}>
        {onRetry && (
          <Button variant="primary" size="md" onClick={onRetry}>
            Try again{modelName ? ` — ${modelName}` : ''}
          </Button>
        )}
        <Button variant="ghost" size="md" onClick={() => navigate('/models')}>
          Browse models
        </Button>
        <Button variant="ghost" size="md" onClick={onDismiss}>
          Choose another
        </Button>
      </div>
    </div>
  )
}

/* ── Main ChatPage ───────────────────────────────────────────────────────── */
export function ChatPage() {
  const { loadedModel, status, loadProgress, loadProgressText, loadModel, error: loadError, dismissError } = useEngine()
  const webgpu = useWebGpu()
  const {
    messages,
    systemPrompt,
    setSystemPrompt,
    defaultSystemPrompt,
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
    // Session state lifted above the router so it survives navigation.
    activeConvId,
    setActiveConvId,
    temperature,
    setTemperature,
    maxTokens,
    setMaxTokens,
    advancedParams,
    setAdvancedParams,
    defaultTemperature,
    defaultMaxTokens,
    defaultAdvancedParams,
    conversations,
    removeConv,
    clearAllConvs,
    exportConversations,
    importConversations,
  } = useChatSession()
  const addToast = useAppStore((s) => s.addToast)
  const autoSpeak = useAppStore((s) => s.settings.autoSpeak)
  const { supported: speechSupported, speakingId: speakingMsgId, speak: speechSpeak, cancel: speechCancel } = useSpeech()

  const [input, setInput] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [showChatSettings, setShowChatSettings] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [viewerFile, setViewerFile] = useState<{ name: string; text: string } | null>(null)
  // Model awaiting the pre-download confirmation dialog, and the last model we
  // attempted to load (so the error state's "Try again" can re-run it).
  const [pendingModel, setPendingModel] = useState<ModelEntry | null>(null)
  const [lastAttempted, setLastAttempted] = useState<ModelEntry | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const docInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  // The input text captured when dictation starts; the transcript is appended to it.
  const micBaseRef = useRef('')

  const modelLoaded = !!loadedModel
  const usedTokens = useMemo(
    () => estimateConversationTokens(messages, systemPrompt),
    [messages, systemPrompt]
  )
  const isLoading = status === 'loading'
  const hasLoadError = status === 'error' && !modelLoaded
  const eta = useDownloadEta(isLoading, loadProgress)
  const supportsVision = loadedModel?.supportsVision === true
  // Images need a vision model; text files work with any loaded model.
  const canAttachImage = modelLoaded && supportsVision && !isGenerating
  const canAttachFile = modelLoaded && !isGenerating
  const canAttach = canAttachImage // drag & paste remain image-only

  /* ── Auto-scroll ────────────────────────────────────────────────────── */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  /* ── Warm the markdown chunk once a model is ready, so the first streamed
        reply renders formatted immediately rather than flashing plain text. ── */
  useEffect(() => {
    if (modelLoaded) void importMarkdown()
  }, [modelLoaded])

  /* ── Handlers ───────────────────────────────────────────────────────── */
  // The actual load. Records the attempt so the error state can retry it.
  const doLoad = useCallback(
    async (model: ModelEntry) => {
      setLastAttempted(model)
      setLoadingId(model.id)
      try {
        await loadModel(model)
      } finally {
        setLoadingId(null)
      }
    },
    [loadModel]
  )

  // Entry point from the welcome card / pickers. Already-cached models load
  // straight away; an uncached model first shows the download-expectations
  // dialog (size, one-time, offline-after, WebGPU check) before pulling weights.
  const requestLoad = useCallback(
    (model: ModelEntry, cached: boolean) => {
      if (cached) void doLoad(model)
      else setPendingModel(model)
    },
    [doLoad]
  )

  const confirmDownload = useCallback(() => {
    const model = pendingModel
    setPendingModel(null)
    if (model) void doLoad(model)
  }, [pendingModel, doLoad])

  const handleRetry = useCallback(() => {
    if (lastAttempted) void doLoad(lastAttempted)
  }, [lastAttempted, doLoad])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isGenerating || !modelLoaded) return
    setInput('')
    await send(text, { temperature, maxTokens, ...advancedToOptions(advancedParams) })
  }, [input, isGenerating, modelLoaded, send, temperature, maxTokens, advancedParams])

  // Current per-conversation generation options, shared by send/regenerate/edit.
  const genOptions = useCallback(
    () => ({ temperature, maxTokens, ...advancedToOptions(advancedParams) }),
    [temperature, maxTokens, advancedParams]
  )

  const handleRegenerate = useCallback(
    (id: string) => {
      if (isGenerating) return
      void regenerate(id, genOptions())
    },
    [isGenerating, regenerate, genOptions]
  )

  const startEdit = useCallback((id: string, content: string) => {
    setEditingId(id)
    setEditText(content)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditText('')
  }, [])

  const saveEdit = useCallback(() => {
    const text = editText.trim()
    const id = editingId
    if (!text || !id || isGenerating) return
    setEditingId(null)
    setEditText('')
    void editUserMessage(id, text, genOptions())
  }, [editText, editingId, isGenerating, editUserMessage, genOptions])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const handleSuggestion = (text: string) => {
    setInput(text)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  /* ── Voice input (speech-to-text) ───────────────────────────────────── */
  const handleTranscript = useCallback((text: string) => {
    setInput((micBaseRef.current ? micBaseRef.current + ' ' : '') + text)
  }, [])
  const stt = useSpeechRecognition(handleTranscript)
  const toggleMic = useCallback(() => {
    if (stt.listening) { stt.stop(); return }
    micBaseRef.current = input.trim()
    stt.start()
  }, [stt, input])

  // The mic button is disabled while the model generates, so end dictation as soon
  // as a send starts generation — otherwise it keeps listening and refilling the
  // input with no way to turn it off until the reply finishes. (`stop` is stable.)
  const { listening: micListening, stop: stopMic } = stt
  useEffect(() => {
    if (isGenerating && micListening) stopMic()
  }, [isGenerating, micListening, stopMic])

  /* ── Voice output: auto-read a finished assistant reply when enabled ── */
  const lastSpokenRef = useRef<string | null>(null)
  useEffect(() => {
    if (!autoSpeak || !speechSupported) return
    const last = messages[messages.length - 1]
    if (
      last &&
      last.role === 'assistant' &&
      !last.streaming &&
      last.content &&
      lastSpokenRef.current !== last.id
    ) {
      lastSpokenRef.current = last.id
      speechSpeak(last.content, last.id)
    }
  }, [messages, autoSpeak, speechSupported, speechSpeak])

  const handleNewChat = useCallback(() => {
    if (isGenerating) stop()
    clearChat()
    setActiveConvId(null)
    setInput('')
    setShowHistory(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [isGenerating, stop, clearChat, setActiveConvId])

  const handleLoadConversation = useCallback(
    (conv: SavedConversation) => {
      // The transcript only renders once a model is loaded (the welcome screen
      // takes over otherwise), so opening a conversation without one would look
      // like nothing happened. Block it and point the user at loading a model.
      if (!modelLoaded) {
        addToast('info', 'Load a model first to open a saved conversation.')
        return
      }
      if (isGenerating) stop()
      loadConversation(conv)
      setActiveConvId(conv.id)
      setShowHistory(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    },
    [modelLoaded, addToast, isGenerating, stop, loadConversation, setActiveConvId]
  )

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      files.forEach(addAttachment)
      e.target.value = ''
    },
    [addAttachment]
  )

  /* ── Conversation import / export ───────────────────────────────────── */
  const downloadJson = useCallback((data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }, [])

  const handleExportAll = useCallback(() => {
    if (conversations.length === 0) return
    const date = new Date().toISOString().slice(0, 10)
    downloadJson(exportConversations(), `web-llm-studio-conversations-${date}.json`)
  }, [conversations.length, exportConversations, downloadJson])

  const handleExportOne = useCallback(
    (id: string, title: string) => {
      const safe = title.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'conversation'
      downloadJson(exportConversations([id]), `wls-${safe}.json`)
    },
    [exportConversations, downloadJson]
  )

  const handleImportClick = useCallback(() => importInputRef.current?.click(), [])

  const handleImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      let raw: unknown
      try {
        raw = JSON.parse(await file.text())
      } catch {
        addToast('error', 'That file isn’t valid JSON.')
        return
      }
      try {
        const count = importConversations(raw)
        addToast('success', `Imported ${count} conversation${count === 1 ? '' : 's'}.`)
      } catch (err) {
        addToast('error', String(err instanceof Error ? err.message : err))
      }
    },
    [importConversations, addToast]
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!canAttach) return
      const items = Array.from(e.clipboardData.items)
      items
        .filter((item) => item.type.startsWith('image/'))
        .forEach((item) => {
          const file = item.getAsFile()
          if (file) addAttachment(file)
        })
    },
    [canAttach, addAttachment]
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (canAttach) {
        e.dataTransfer.dropEffect = 'copy'
        setIsDragOver(true)
      }
    },
    [canAttach]
  )

  const handleDragLeave = useCallback(() => setIsDragOver(false), [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      if (!canAttach) return
      Array.from(e.dataTransfer.files)
        .filter((f) => f.type.startsWith('image/'))
        .forEach(addAttachment)
    },
    [canAttach, addAttachment]
  )

  return (
    <div className={styles.page}>
      {/* ── History panel ──────────────────────────────────────────────── */}
      <ChatHistoryPanel
        open={showHistory}
        conversations={conversations}
        activeId={activeConvId}
        onClose={() => setShowHistory(false)}
        onSelect={handleLoadConversation}
        onDelete={removeConv}
        onClearAll={clearAllConvs}
        onNewChat={handleNewChat}
        onImport={handleImportClick}
        onExportAll={handleExportAll}
        onExportOne={handleExportOne}
        canOpen={modelLoaded}
      />

      {/* ── Status bar ─────────────────────────────────────────────────── */}
      <StatusBar
        onToggleHistory={() => setShowHistory((s) => !s)}
        canNewChat={messages.length > 0}
        onNewChat={handleNewChat}
      />

      {/* ── Loading progress bar ────────────────────────────────────────── */}
      {isLoading && (
        <div className={styles.loadingBar}>
          <Progress value={loadProgress} size="sm" variant="accent" />
          <span className={styles.loadingText}>
            {loadProgressText || 'Downloading model…'} ({loadProgress}%)
            {eta ? ` · ~${eta} left` : ''}
          </span>
        </div>
      )}

      {/* ── Floating button → opens this conversation's settings modal. Shown
            once there's a usable chat — a model is loaded (a ready/new chat) or
            an existing conversation is open — and hidden on the welcome screen,
            where there's no chat to configure yet. ── */}
      {(modelLoaded || messages.length > 0) && (
        <button
          className={styles.chatSettingsFab}
          onClick={() => setShowChatSettings(true)}
          title="Chat settings"
          aria-label="Chat settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}

      {/* ── This conversation's settings (system prompt + generation params) ── */}
      <Modal open={showChatSettings && (modelLoaded || messages.length > 0)} onClose={() => setShowChatSettings(false)} title="Chat Settings">
        <div className={styles.chatSettingsSubtitleRow}>
          <p className={styles.chatSettingsSubtitle}>
            These settings apply to this conversation only. New chats start from
            your defaults — change those in Settings.
          </p>
          {(systemPrompt !== defaultSystemPrompt ||
            temperature !== defaultTemperature ||
            maxTokens !== defaultMaxTokens ||
            JSON.stringify(advancedParams) !== JSON.stringify(defaultAdvancedParams)) && (
            <button
              type="button"
              className={styles.sysPromptReset}
              onClick={() => {
                setSystemPrompt(defaultSystemPrompt)
                setTemperature(defaultTemperature)
                setMaxTokens(defaultMaxTokens)
                setAdvancedParams(defaultAdvancedParams)
              }}
            >
              Reset to defaults
            </button>
          )}
        </div>

        <div className={styles.sysPromptLabelRow}>
          <label className={styles.sysPromptLabel}>System Prompt</label>
        </div>
        <textarea
          className={styles.sysPromptInput}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={6}
          placeholder="Set the assistant's behavior and persona…"
        />

        <div className={styles.settingsRow}>
          <div className={styles.settingItem}>
            <span>Temperature</span>
            <div className={styles.settingControl}>
              <input
                type="range"
                min={0} max={2} step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className={styles.range}
                aria-label="Temperature"
              />
              <strong>{temperature.toFixed(1)}</strong>
            </div>
          </div>
          <div className={styles.settingItem}>
            <span>Max tokens</span>
            <div className={styles.settingControl}>
              <input
                type="range"
                min={64} max={4096} step={64}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className={styles.range}
                aria-label="Max tokens"
              />
              <strong>{maxTokens}</strong>
            </div>
          </div>
        </div>

        <details className={styles.advancedDetails}>
          <summary className={styles.advancedSummary}>Advanced parameters</summary>
          <AdvancedParamsEditor value={advancedParams} onChange={setAdvancedParams} />
        </details>
      </Modal>

      {/* ── Messages area ───────────────────────────────────────────────── */}
      <div className={styles.messages}>
        {hasLoadError ? (
          <ChatLoadError
            error={loadError || ''}
            modelName={lastAttempted?.name}
            onRetry={lastAttempted ? handleRetry : undefined}
            onDismiss={dismissError}
          />
        ) : !modelLoaded && !isLoading ? (
          <ChatWelcome onLoad={requestLoad} loadingId={loadingId} webgpu={webgpu} />
        ) : isLoading && messages.length === 0 ? (
          <div className={styles.loadingState}>
            <Spinner size="lg" />
            <p className={styles.loadingStateText}>
              {lastAttempted ? `Setting up ${lastAttempted.name}…` : 'Setting up your model…'}
            </p>
            <p className={styles.loadingStateSub}>
              {loadProgressText || 'Downloading…'}{loadProgress > 0 ? ` · ${loadProgress}%` : ''}
              {eta ? ` · ~${eta} left` : ''}
            </p>
            <p className={styles.loadingStateHint}>
              First load downloads the model once — afterwards it's cached on your device
              and loads instantly, even offline. Keep this tab open while it downloads.
            </p>
          </div>
        ) : messages.length === 0 ? (
          <ChatReady modelName={loadedModel!.name} onSuggestion={handleSuggestion} />
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`${styles.message} ${styles[msg.role]}`}>
              <div className={styles.msgHeader}>
                <span className={styles.msgRole}>
                  {msg.role === 'user' ? 'You' : (msg.modelName ?? loadedModel?.name ?? 'Assistant')}
                </span>
                {!msg.streaming && editingId !== msg.id && (
                  <div className={styles.msgActions}>
                    {msg.role === 'user' && (
                      <button
                        className={styles.copyBtn}
                        onClick={() => startEdit(msg.id, msg.content)}
                        disabled={isGenerating}
                        title="Edit & regenerate"
                        aria-label="Edit message"
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11 2.5l2.5 2.5M2.5 13.5l.5-2.3 7-7 1.8 1.8-7 7-2.3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                      </button>
                    )}
                    {msg.role === 'assistant' && (
                      <button
                        className={styles.copyBtn}
                        onClick={() => handleRegenerate(msg.id)}
                        disabled={isGenerating}
                        title="Regenerate"
                        aria-label="Regenerate response"
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                    )}
                    {msg.role === 'assistant' && speechSupported && msg.content && (
                      <button
                        className={styles.copyBtn}
                        onClick={() => (
                          speakingMsgId === msg.id
                            ? speechCancel()
                            : speechSpeak(msg.content, msg.id)
                        )}
                        title={speakingMsgId === msg.id ? 'Stop reading' : 'Read aloud'}
                        aria-label={speakingMsgId === msg.id ? 'Stop reading' : 'Read aloud'}
                      >
                        {speakingMsgId === msg.id ? (
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="4" y="4" width="8" height="8" rx="1.4" fill="currentColor"/></svg>
                        ) : (
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8.5 2.5L5 5.5H2.5v5H5l3.5 3v-11z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                        )}
                      </button>
                    )}
                    <CopyButton text={msg.content} />
                  </div>
                )}
              </div>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className={styles.msgAttachments}>
                  {msg.attachments.map((att, i) =>
                    att.kind === 'image' && att.dataUrl ? (
                      <img key={i} src={att.dataUrl} alt={att.name} className={styles.msgAttachImg} title={att.name} />
                    ) : att.text ? (
                      <button
                        key={i}
                        type="button"
                        className={`${styles.msgAttachChip} ${styles.msgAttachClickable}`}
                        title={`View ${att.name}`}
                        onClick={() => setViewerFile({ name: att.name, text: att.text! })}
                      >
                        <span aria-hidden="true">📄</span>
                        <span className={styles.msgAttachName}>{att.name}</span>
                      </button>
                    ) : (
                      <span key={i} className={styles.msgAttachChip} title={att.name}>
                        <span aria-hidden="true">{att.kind === 'image' ? '🖼' : '📄'}</span>
                        <span className={styles.msgAttachName}>{att.name}</span>
                      </span>
                    )
                  )}
                </div>
              )}
              {editingId === msg.id ? (
                <div className={styles.msgEdit}>
                  <textarea
                    className={styles.msgEditInput}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
                      if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
                    }}
                    rows={3}
                    autoFocus
                    aria-label="Edit message"
                  />
                  <div className={styles.msgEditActions}>
                    <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
                    <Button size="sm" variant="primary" onClick={saveEdit} disabled={!editText.trim() || isGenerating}>
                      Save &amp; regenerate
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={styles.msgBubble}>
                  {msg.role === 'assistant' ? (
                    <Suspense fallback={msg.content}>
                      <MarkdownMessage content={msg.content} streaming={msg.streaming} />
                    </Suspense>
                  ) : (
                    msg.content
                  )}
                </div>
              )}
              {msg.role === 'assistant' && !msg.streaming && msg.stats && editingId !== msg.id && (
                <div className={styles.msgStats}>
                  {formatGenTime(msg.stats.elapsedMs)} · {msg.stats.tokenCount} tok · {msg.stats.tokensPerSec} tok/s
                </div>
              )}
            </div>
          ))
        )}

        {error && (
          <div className={styles.errorBanner} role="alert">
            <strong>Error</strong> — {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Context-usage meter — shown whenever a model with a known window
            is loaded, including an empty new chat (baseline = system prompt). ── */}
      {modelLoaded && loadedModel?.contextWindow && (
        <ContextMeter used={usedTokens} total={loadedModel.contextWindow} />
      )}

      {/* ── Composer — single-row, WhatsApp-style ───────────────────────── */}
      <div className={styles.composer}>
        {/* Attachment previews sit above the input row */}
        {attachments.length > 0 && (
          <div className={styles.attachmentList}>
            {attachments.map((att) => (
              <div key={att.id} className={styles.attachmentItem}>
                {att.mimeType.startsWith('image/') ? (
                  <img src={att.url} alt={att.name} className={styles.attachmentThumb} />
                ) : (
                  <div className={styles.attachmentFile}>
                    <span className={styles.attachmentIcon} aria-hidden="true">📄</span>
                  </div>
                )}
                <span className={styles.attachmentName} title={att.name}>
                  {att.name.length > 16 ? att.name.slice(0, 13) + '…' : att.name}
                </span>
                <button
                  className={styles.attachmentRemove}
                  onClick={() => removeAttachment(att.id)}
                  aria-label={`Remove ${att.name}`}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          className={`${styles.composerRow} ${isDragOver ? styles.composerDragOver : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Attach menu — always visible; unusable options shown disabled */}
          <div className={styles.menuWrap}>
            {showMenu && <div className={styles.menuBackdrop} onClick={() => setShowMenu(false)} aria-hidden="true" />}
            <button
              className={`${styles.roundBtn} ${showMenu ? styles.roundBtnActive : ''}`}
              onClick={() => setShowMenu((s) => !s)}
              aria-label="Attach"
              aria-expanded={showMenu}
              title="Attach"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ transform: showMenu ? 'rotate(45deg)' : 'none', transition: 'transform 160ms ease' }}>
                <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
            {showMenu && (
              <div className={styles.composerMenu} role="menu">
                <button
                  className={`${styles.menuItem} ${!canAttachImage ? styles.menuItemDisabled : ''}`}
                  role="menuitem"
                  disabled={!canAttachImage}
                  title={!modelLoaded ? 'Load a model first' : !supportsVision ? 'Current model does not support images' : 'Attach image'}
                  onClick={() => { fileInputRef.current?.click(); setShowMenu(false) }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.4"/><circle cx="5.5" cy="6" r="1.3" stroke="currentColor" strokeWidth="1.2"/><path d="M2 11l3.5-3 2.5 2 3-3 3 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Photo
                  {modelLoaded && !supportsVision && <span className={styles.menuItemHint}>needs vision</span>}
                </button>
                <button
                  className={`${styles.menuItem} ${!canAttachFile ? styles.menuItemDisabled : ''}`}
                  role="menuitem"
                  disabled={!canAttachFile}
                  title={!modelLoaded ? 'Load a model first' : 'Attach file'}
                  onClick={() => { docInputRef.current?.click(); setShowMenu(false) }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 1.5h5l3.5 3.5v9a.5.5 0 01-.5.5H4a.5.5 0 01-.5-.5v-12a.5.5 0 01.5-.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M9 1.5V5h3.5M5.5 8.5h5M5.5 11h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                  File
                </button>
              </div>
            )}
          </div>

          {/* The pill: single-line text input */}
          <div className={styles.composerField}>
            {isDragOver && (
              <div className={styles.dragOverlay} aria-hidden="true">
                <span>Drop images here</span>
              </div>
            )}
            <textarea
              ref={inputRef}
              className={styles.composerInput}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                !modelLoaded
                  ? 'Load a model to chat…'
                  : isGenerating
                  ? 'Generating…'
                  : 'Message…'
              }
              disabled={!modelLoaded || isGenerating}
              rows={1}
              aria-label="Chat message input"
            />
          </div>

          {/* Voice input — uses the browser speech service (audio may leave device) */}
          {stt.supported && (
            <button
              className={`${styles.roundBtn} ${stt.listening ? styles.micActive : ''}`}
              onClick={toggleMic}
              disabled={!modelLoaded || isGenerating}
              title={stt.listening ? 'Stop dictation' : 'Voice input — uses your browser’s speech service, so audio may leave your device'}
              aria-label="Voice input"
              aria-pressed={stt.listening}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="6" y="1.5" width="4" height="8" rx="2" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M3.5 7a4.5 4.5 0 0 0 9 0M8 11.5V14M5.5 14h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
          )}

          {/* Send / Stop — circular accent button */}
          {isGenerating ? (
            <button
              className={`${styles.roundBtn} ${styles.stopBtn}`}
              onClick={stop}
              aria-label="Stop generating"
              title="Stop"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor"/></svg>
            </button>
          ) : (
            <button
              className={`${styles.sendBtn} ${!modelLoaded || !input.trim() ? styles.sendBtnDisabled : ''}`}
              onClick={handleSend}
              disabled={!modelLoaded || !input.trim() || isGenerating}
              aria-label="Send message"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M3 9h12M10 4l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>

        <p className={styles.composerHint}>
          Enter to send · Shift+Enter for newline ·{' '}
          {canAttach ? 'Drag & drop images to attach · ' : ''}
          Runs locally in your browser
          {stt.supported ? ' · 🎤 voice input uses your browser’s speech service' : ''}
        </p>
      </div>

      {/* ── Hidden file inputs ──────────────────────────────────────────── */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={docInputRef}
        type="file"
        accept=".pdf,application/pdf,.txt,.md,.markdown,.json,.csv,.tsv,.log,.xml,.yaml,.yml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.rs,.go,.rb,.php,.sh,text/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      {/* Attached-file viewer (small text files kept in history) */}
      {viewerFile && (
        <Modal open onClose={() => setViewerFile(null)} title={viewerFile.name} size="lg">
          <pre className={styles.fileViewer}>{viewerFile.text}</pre>
        </Modal>
      )}

      {/* ── Pre-download expectations dialog ───────────────────────────── */}
      <ModelDownloadDialog
        open={pendingModel !== null}
        model={pendingModel}
        webgpu={webgpu}
        onConfirm={confirmDownload}
        onCancel={() => setPendingModel(null)}
      />
    </div>
  )
}
