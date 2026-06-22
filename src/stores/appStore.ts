import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ModelEntry } from '../catalog/types'
import type { EngineStatus } from '../engines/base'

export type Theme = 'light' | 'dark' | 'system'
export type CacheBackend = 'cache-api' | 'indexeddb' | 'opfs'

interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
}

interface EngineState {
  status: EngineStatus
  loadedModel: ModelEntry | null
  loadProgress: number
  loadProgressText: string
  error: string | null
}

interface Settings {
  theme: Theme
  cacheBackend: CacheBackend
  devLogs: boolean
  /** Automatically read new assistant replies aloud (local speechSynthesis). */
  autoSpeak: boolean
}

interface AppState {
  // Engine runtime state (not persisted)
  engine: EngineState

  // User settings (persisted)
  settings: Settings

  // Toast notifications (not persisted)
  toasts: Toast[]

  // Actions
  setEngineStatus: (status: EngineStatus) => void
  setLoadedModel: (model: ModelEntry | null) => void
  setLoadProgress: (progress: number, text: string) => void
  setEngineError: (error: string | null) => void
  updateSettings: (patch: Partial<Settings>) => void
  addToast: (type: Toast['type'], message: string) => void
  removeToast: (id: string) => void
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  cacheBackend: 'cache-api',
  devLogs: false,
  autoSpeak: false,
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      engine: {
        status: 'idle',
        loadedModel: null,
        loadProgress: 0,
        loadProgressText: '',
        error: null,
      },
      settings: DEFAULT_SETTINGS,
      toasts: [],

      setEngineStatus: (status) =>
        set((s) => ({ engine: { ...s.engine, status } })),

      setLoadedModel: (model) =>
        set((s) => ({ engine: { ...s.engine, loadedModel: model } })),

      setLoadProgress: (progress, text) =>
        set((s) => ({
          engine: {
            ...s.engine,
            loadProgress: progress,
            loadProgressText: text,
          },
        })),

      setEngineError: (error) =>
        set((s) => ({ engine: { ...s.engine, error } })),

      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      addToast: (type, message) => {
        const id = `${Date.now()}-${Math.random()}`
        set((s) => ({ toasts: [...s.toasts, { id, type, message }] }))
        // Errors stay until the user dismisses them — they're easy to miss when
        // they auto-vanish (e.g. a model-load failure flashing by). Other types
        // remain transient.
        if (type === 'error') return
        setTimeout(() => {
          set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
        }, 4500)
      },

      removeToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: 'web-llm-studio-settings',
      partialize: (state) => ({ settings: state.settings }),
    }
  )
)
