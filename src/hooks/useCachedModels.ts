import { useState, useEffect, useCallback, useMemo } from 'react'
import { getCachedModelIds } from '../cache/cacheService'
import type { ModelEntry } from '../catalog/types'

/**
 * Tracks which models (by `model.id`) are downloaded/cached locally — across
 * both engines (WebLLM via Cache API, Wllama GGUF via OPFS) — so the UI can mark
 * them. Scans once on mount and exposes `refresh` to re-scan after a model is
 * loaded or its cache deleted.
 */
export function useCachedModels(models: ModelEntry[]) {
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set())

  // Stabilize the array by the set of ids so the scan re-runs only when the
  // catalog actually changes, not on every render (array identity differs each
  // time). Keyed on the id list, not the array reference, on purpose.
  const key = models.map((m) => m.id).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableModels = useMemo(() => models, [key])

  const refresh = useCallback(async () => {
    setCachedIds(await getCachedModelIds(stableModels))
  }, [stableModels])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { cachedIds, refresh }
}
