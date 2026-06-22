import { useState, useCallback, useEffect } from 'react'
import { engineManager } from '../engines/engineManager'
import { useAppStore } from '../stores/appStore'
import type { ModelEntry } from '../catalog/types'
import type { EngineStatus } from '../engines/base'

export function useEngine() {
  const {
    engine,
    setEngineStatus,
    setLoadedModel,
    setLoadProgress,
    setEngineError,
    addToast,
    settings,
  } = useAppStore()

  const [localStatus, setLocalStatus] = useState<EngineStatus>(engine.status)

  useEffect(() => {
    return engineManager.subscribe((status, model) => {
      setLocalStatus(status)
      setEngineStatus(status)
      setLoadedModel(model)
    })
  }, [setEngineStatus, setLoadedModel])

  const loadModel = useCallback(
    async (model: ModelEntry) => {
      setEngineError(null)
      setLoadProgress(0, 'Initializing...')
      setEngineStatus('loading')

      try {
        await engineManager.load(model, {
          cacheBackend: settings.cacheBackend,
          onProgress: (pct, text) => setLoadProgress(pct, text),
        })
        addToast('success', `${model.name} loaded successfully`)
      } catch (err) {
        const message = String(err instanceof Error ? err.message : err)
        setEngineError(message)
        setEngineStatus('error')
        // The engine's load() resolves its own status to 'idle' in a finally and
        // never re-notifies subscribers on the throw path, so localStatus would
        // otherwise stay stuck on 'loading'. Mirror the error locally so the UI
        // can show a recovery state instead of a perpetual progress bar.
        setLocalStatus('error')
        addToast('error', `Failed to load model: ${message}`)
      }
    },
    [settings, setEngineError, setLoadProgress, setEngineStatus, addToast]
  )

  // Clear an errored load so the welcome/model picker is shown again.
  const dismissError = useCallback(() => {
    setEngineError(null)
    setEngineStatus('idle')
    setLoadProgress(0, '')
    setLocalStatus('idle')
  }, [setEngineError, setEngineStatus, setLoadProgress])

  const unloadModel = useCallback(async () => {
    try {
      await engineManager.unload()
      addToast('info', 'Model unloaded')
    } catch (err) {
      addToast('error', `Failed to unload: ${String(err)}`)
    }
  }, [addToast])

  const deleteCache = useCallback(async (model: ModelEntry): Promise<void> => {
    return engineManager.deleteCache(model)
  }, [])

  return {
    status: localStatus,
    loadedModel: engine.loadedModel,
    loadProgress: engine.loadProgress,
    loadProgressText: engine.loadProgressText,
    error: engine.error,
    isLoaded: engineManager.isLoaded(),
    loadModel,
    unloadModel,
    deleteCache,
    dismissError,
  }
}
