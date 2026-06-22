import { useState, useCallback, useMemo } from 'react'
import { useModelCatalog } from '../hooks/useModelCatalog'
import { useEngine } from '../hooks/useEngine'
import { useCachedModels } from '../hooks/useCachedModels'
import { useAppStore } from '../stores/appStore'
import { ModelCard } from '../components/model/ModelCard'
import { ModelDetailModal } from '../components/model/ModelDetailModal'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { EmptyState } from '../components/ui/EmptyState'
import type { ModelEntry, EngineType, ModelFormat, SortKey, QuantizationType } from '../catalog/types'
import styles from './ModelsPage.module.css'

const ENGINE_OPTS: { value: EngineType; label: string }[] = [
  { value: 'webllm', label: 'WebLLM' },
  { value: 'wllama', label: 'Wllama (GGUF)' },
]

const FORMAT_OPTS: { value: ModelFormat; label: string }[] = [
  { value: 'mlc', label: 'MLC' },
  { value: 'gguf', label: 'GGUF' },
]

const SORT_OPTS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'size', label: 'Size (small first)' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'engine', label: 'Engine' },
] as const

const RAM_OPTS = [
  { value: '', label: 'Any' },
  { value: '1024', label: '≤ 1 GB' },
  { value: '2048', label: '≤ 2 GB' },
  { value: '4096', label: '≤ 4 GB' },
  { value: '6144', label: '≤ 6 GB' },
] as const

export function ModelsPage() {
  const { allModels, filtered, loading, error, filter, setFilter, sortKey, setSortKey } =
    useModelCatalog()
  const { loadModel, unloadModel, status, loadedModel, loadProgress, loadProgressText, deleteCache } =
    useEngine()
  const { addToast } = useAppStore()

  const [detailModel, setDetailModel] = useState<ModelEntry | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [downloadedMode, setDownloadedMode] = useState<'first' | 'only' | 'all'>('first')

  const { cachedIds, refresh: refreshCache } = useCachedModels(allModels)

  // Apply the download-aware filter/sort on top of the catalog's own result.
  // (Cache state lives here, not in the catalog hook, so it's layered on last.)
  const displayed = useMemo(() => {
    let list = filtered
    if (downloadedMode === 'only') list = list.filter((m) => cachedIds.has(m.id))
    if (downloadedMode === 'first') {
      list = [...list].sort(
        (a, b) => Number(cachedIds.has(b.id)) - Number(cachedIds.has(a.id))
      )
    }
    return list
  }, [filtered, cachedIds, downloadedMode])

  // Only offer quantizations that actually exist in the loaded catalog.
  const availableQuants = useMemo(
    () => Array.from(new Set(allModels.map((m) => m.quantization))).sort(),
    [allModels]
  )

  const activeFilterCount = [
    filter.engines.length > 0,
    filter.formats.length > 0,
    filter.recommendedOnly,
    filter.visionOnly,
    !filter.includeExperimental,
    !filter.excludeDisabled,
    filter.isMoe !== null,
    filter.quantizations.length > 0,
    filter.maxRamMb !== null,
  ].filter(Boolean).length

  const isLoading = status === 'loading'

  const handleLoad = useCallback(
    async (model: ModelEntry) => {
      setLoadingId(model.id)
      try {
        await loadModel(model)
        refreshCache()
      } finally {
        setLoadingId(null)
      }
    },
    [loadModel, refreshCache]
  )

  const handleDeleteCache = useCallback(
    async (model: ModelEntry) => {
      try {
        await deleteCache(model)
        refreshCache()
        addToast('success', `Cache deleted for ${model.name}`)
      } catch (e) {
        addToast('error', `Failed to delete cache: ${String(e)}`)
        throw e
      }
    },
    [deleteCache, addToast, refreshCache]
  )

  function toggleEngine(val: EngineType) {
    setFilter((f) => ({
      ...f,
      engines: f.engines.includes(val) ? f.engines.filter((x) => x !== val) : [...f.engines, val],
    }))
  }

  function toggleFormat(val: ModelFormat) {
    setFilter((f) => ({
      ...f,
      formats: f.formats.includes(val) ? f.formats.filter((x) => x !== val) : [...f.formats, val],
    }))
  }

  function toggleQuant(val: QuantizationType) {
    setFilter((f) => ({
      ...f,
      quantizations: f.quantizations.includes(val)
        ? f.quantizations.filter((x) => x !== val)
        : [...f.quantizations, val],
    }))
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Models</h1>
          <p className={styles.subtitle}>
            {loading ? 'Loading catalog…' : `${displayed.length} of ${allModels.length} models`}
          </p>
        </div>
      </div>


      {/* Mobile filter toggle */}
      <div className={styles.filterToggleRow}>
        <input
          type="search"
          className={styles.searchInput}
          style={{ flex: 1 }}
          placeholder="Search models…"
          value={filter.search}
          onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
        />
        <button
          className={styles.filterToggleBtn}
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
        >
          Filters
          {activeFilterCount > 0 && (
            <span className={styles.filterBadge}>{activeFilterCount}</span>
          )}
        </button>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          ⚠ Catalog error: {error}. Showing fallback catalog.
        </div>
      )}

      <div className={styles.layout}>
        {/* Filters sidebar */}
        <aside className={`${styles.filters} ${filtersOpen ? styles.filtersOpen : ''}`}>
          <div className={styles.filterSection}>
            <label className={styles.filterLabel}>Engine</label>
            <div className={styles.checkGroup}>
              {ENGINE_OPTS.map((o) => (
                <label key={o.value} className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={filter.engines.includes(o.value)}
                    onChange={() => toggleEngine(o.value)}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </div>

          <div className={styles.filterSection}>
            <label className={styles.filterLabel}>Format</label>
            <div className={styles.checkGroup}>
              {FORMAT_OPTS.map((o) => (
                <label key={o.value} className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={filter.formats.includes(o.value)}
                    onChange={() => toggleFormat(o.value)}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </div>

          <div className={styles.filterSection}>
            <label className={styles.filterLabel}>Show</label>
            <div className={styles.checkGroup}>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={filter.recommendedOnly}
                  onChange={(e) => setFilter((f) => ({ ...f, recommendedOnly: e.target.checked }))}
                />
                Recommended only
              </label>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={filter.visionOnly}
                  onChange={(e) => setFilter((f) => ({ ...f, visionOnly: e.target.checked }))}
                />
                Vision only 👁
              </label>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={filter.includeExperimental}
                  onChange={(e) => setFilter((f) => ({ ...f, includeExperimental: e.target.checked }))}
                />
                Include experimental
              </label>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={!filter.excludeDisabled}
                  onChange={(e) => setFilter((f) => ({ ...f, excludeDisabled: !e.target.checked }))}
                />
                Show disabled
              </label>
            </div>
          </div>

          <div className={styles.filterSection}>
            <label className={styles.filterLabel}>Downloaded</label>
            <div className={styles.checkGroup}>
              <label className={styles.checkLabel}>
                <input
                  type="radio"
                  name="downloaded"
                  checked={downloadedMode === 'first'}
                  onChange={() => setDownloadedMode('first')}
                />
                Downloaded first
              </label>
              <label className={styles.checkLabel}>
                <input
                  type="radio"
                  name="downloaded"
                  checked={downloadedMode === 'only'}
                  onChange={() => setDownloadedMode('only')}
                />
                Downloaded only
              </label>
              <label className={styles.checkLabel}>
                <input
                  type="radio"
                  name="downloaded"
                  checked={downloadedMode === 'all'}
                  onChange={() => setDownloadedMode('all')}
                />
                All
              </label>
            </div>
          </div>

          <div className={styles.filterSection}>
            <label className={styles.filterLabel}>MoE Models</label>
            <div className={styles.checkGroup}>
              <label className={styles.checkLabel}>
                <input
                  type="radio"
                  name="moe"
                  checked={filter.isMoe === null}
                  onChange={() => setFilter((f) => ({ ...f, isMoe: null }))}
                />
                All
              </label>
              <label className={styles.checkLabel}>
                <input
                  type="radio"
                  name="moe"
                  checked={filter.isMoe === true}
                  onChange={() => setFilter((f) => ({ ...f, isMoe: true }))}
                />
                MoE only
              </label>
              <label className={styles.checkLabel}>
                <input
                  type="radio"
                  name="moe"
                  checked={filter.isMoe === false}
                  onChange={() => setFilter((f) => ({ ...f, isMoe: false }))}
                />
                Non-MoE only
              </label>
            </div>
          </div>

          {availableQuants.length > 1 && (
            <div className={styles.filterSection}>
              <label className={styles.filterLabel}>Quantization</label>
              <div className={styles.checkGroup}>
                {availableQuants.map((q) => (
                  <label key={q} className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={filter.quantizations.includes(q)}
                      onChange={() => toggleQuant(q)}
                    />
                    {q.toUpperCase()}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className={styles.filterSection}>
            <label className={styles.filterLabel}>Max RAM</label>
            <select
              className={styles.select}
              value={filter.maxRamMb === null ? '' : String(filter.maxRamMb)}
              onChange={(e) =>
                setFilter((f) => ({ ...f, maxRamMb: e.target.value ? Number(e.target.value) : null }))
              }
            >
              {RAM_OPTS.map((o) => (
                <option key={o.label} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.filterSection}>
            <label className={styles.filterLabel}>Sort by</label>
            <select
              className={styles.select}
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              {SORT_OPTS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.resetRow}>
            <Button
              size="sm"
              variant="ghost"
              fullWidth
              onClick={() => {
                setFilter({
                  search: '', engines: [], formats: [], recommendedOnly: false,
                  includeExperimental: true, excludeDisabled: true, visionOnly: false,
                  isMoe: null, quantizations: [], maxRamMb: null
                })
                setDownloadedMode('first')
              }}
            >
              Reset Filters
            </Button>
          </div>
        </aside>

        {/* Model grid */}
        <div className={styles.gridArea}>
          {isLoading && loadingId && (
            <div className={styles.loadingBanner}>
              <Spinner size="sm" />
              <span>Loading model… {loadProgress}% — {loadProgressText}</span>
            </div>
          )}

          {loading ? (
            <div className={styles.spinner}><Spinner size="lg" /><span>Loading catalog…</span></div>
          ) : displayed.length === 0 ? (
            <EmptyState
              icon="🔍"
              title="No models match your filters"
              description="Try adjusting the search or filters, or reset to see all models."
            />
          ) : (
            <div className={styles.grid}>
              {displayed.map((model) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  isLoaded={loadedModel?.id === model.id}
                  isLoading={loadingId === model.id && isLoading}
                  isCached={cachedIds.has(model.id)}
                  onLoad={handleLoad}
                  onUnload={unloadModel}
                  onDetails={setDetailModel}
                  onDeleteCache={handleDeleteCache}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <ModelDetailModal
        model={detailModel}
        onClose={() => setDetailModel(null)}
        isLoaded={detailModel?.id === loadedModel?.id}
        isLoading={isLoading}
        onLoad={handleLoad}
        onUnload={unloadModel}
      />
    </div>
  )
}
