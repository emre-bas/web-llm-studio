import { useState, useEffect } from 'react'
import type { ModelEntry, ModelFilter, SortKey } from '../catalog/types'
import { loadBundledCatalog, enrichWithDynamicWebllm } from '../catalog/modelCatalog'
import { applyFilters, sortModels, DEFAULT_FILTER } from '../catalog/filters'
import { useDeviceProfile } from './useDeviceProfile'
import { fitsDevice } from '../catalog/deviceFit'

export function useModelCatalog() {
  const [allModels, setAllModels] = useState<ModelEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<ModelFilter>(DEFAULT_FILTER)
  const [sortKey, setSortKey] = useState<SortKey>('recommended')
  const deviceProfile = useDeviceProfile()

  useEffect(() => {
    let cancelled = false
    // Phase 1: show the bundled catalog immediately.
    loadBundledCatalog()
      .then((bundled) => {
        if (cancelled) return
        setAllModels(bundled)
        setLoading(false)
        // Phase 2: enrich with the current list from the CDN in the background.
        setRefreshing(true)
        enrichWithDynamicWebllm(bundled)
          .then((full) => { if (!cancelled) setAllModels(full) })
          .finally(() => { if (!cancelled) setRefreshing(false) })
      })
      .catch((err) => {
        if (cancelled) return
        setError(String(err))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const afterFilters = applyFilters(allModels, filter)
  // When "Recommended only" is active, additionally require the model to fit
  // the current device (RAM, WebGPU availability, mobile).
  const afterDevice = filter.recommendedOnly
    ? afterFilters.filter((m) => fitsDevice(m, deviceProfile))
    : afterFilters
  const filtered = sortModels(afterDevice, sortKey)

  return {
    allModels,
    filtered,
    loading,
    refreshing,
    error,
    filter,
    setFilter,
    sortKey,
    setSortKey,
  }
}
