import type { ModelEntry, ModelCatalog } from './types'
import { FALLBACK_CATALOG } from './fallbackCatalog'
import { fetchWebllmModelsFromCdn } from './webllmDynamic'
import { createLogger } from '../utils/logger'

const log = createLogger('ModelCatalog')

// Curated fields we let the bundled catalog override on top of dynamically
// discovered models (so our headline models keep nice names/descriptions).
const CURATED_FIELDS = [
  'name', 'provider', 'description', 'recommended', 'experimental',
  'supportsVision', 'tags', 'warnings', 'license', 'sourceUrl',
  'architecture', 'parameterSize', 'sizeLabel', 'estimatedRam', 'estimatedVram',
] as const

// Merge a curated entry's hand-authored fields onto a dynamically-built one.
function applyCuration(base: ModelEntry, curated: ModelEntry): ModelEntry {
  const out: ModelEntry = { ...base }
  for (const key of CURATED_FIELDS) {
    const val = curated[key]
    if (val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(out as any)[key] = val
    }
  }
  return out
}

const CATALOG_URLS = [
  './catalogs/webllm.json',
  './catalogs/gguf.json',
] as const

function isValidModel(m: unknown): m is ModelEntry {
  if (typeof m !== 'object' || m === null) return false
  const obj = m as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.engine === 'string' &&
    typeof obj.modelId === 'string'
  )
}

async function fetchCatalog(url: string): Promise<ModelEntry[]> {
  const resp = await fetch(url, { cache: 'no-cache' })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data: unknown = await resp.json()

  if (Array.isArray(data)) {
    return data.filter(isValidModel)
  }
  if (typeof data === 'object' && data !== null && 'models' in data) {
    const catalog = data as ModelCatalog
    return Array.isArray(catalog.models) ? catalog.models.filter(isValidModel) : []
  }
  return []
}

function deduplicateById(models: ModelEntry[]): ModelEntry[] {
  const seen = new Set<string>()
  return models.filter((m) => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })
}

// WebLLM's prebuilt list ships several entries per base model that differ only
// in default context window — e.g. `gemma-2-2b-it-q4f16_1-MLC` (full) and
// `gemma-2-2b-it-q4f16_1-MLC-1k` (1024-token, lower VRAM). They share the same
// weights and quantization, so on the Models page they read as duplicate cards
// (identical name, identical quant badge). Collapse each such group to a single
// representative. Quantization variants (q4f16 vs q4f32) keep distinct base keys
// and are NOT collapsed — the card surfaces the quant and the choice is real.
const CONTEXT_SUFFIX = /-(\d+)k$/i

// Group key = the modelId with any trailing `-Nk` context suffix removed.
function contextBaseKey(modelId: string): string {
  return modelId.replace(CONTEXT_SUFFIX, '').toLowerCase()
}

// Tokens in a variant's reduced window; the full-context variant has no suffix
// and is treated as the largest (Infinity) so it always wins.
function variantWindow(modelId: string): number {
  const m = modelId.match(CONTEXT_SUFFIX)
  return m ? Number(m[1]) : Infinity
}

export function collapseContextVariants(models: ModelEntry[]): ModelEntry[] {
  const groups = new Map<string, ModelEntry[]>()
  for (const m of models) {
    const key = contextBaseKey(m.modelId)
    const group = groups.get(key)
    if (group) group.push(m)
    else groups.set(key, [m])
  }
  const out: ModelEntry[] = []
  for (const group of groups.values()) {
    // Prefer the full-context variant; if a base ships only reduced variants,
    // keep the one with the largest window.
    out.push(
      group.reduce((best, m) =>
        variantWindow(m.modelId) > variantWindow(best.modelId) ? m : best
      )
    )
  }
  return out
}

// Phase 1: the catalog shipped with this build — instant, used for GGUF models
// and as the curation source / offline fallback for WebLLM.
async function loadBundledCatalogUncached(): Promise<ModelEntry[]> {
  const results = await Promise.allSettled(CATALOG_URLS.map((url) => fetchCatalog(url)))
  const bundled: ModelEntry[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') bundled.push(...result.value)
    else log.warn('Failed to load a bundled catalog:', result.reason)
  }
  const list = bundled.length > 0 ? bundled : FALLBACK_CATALOG
  return deduplicateById(list)
}

// Several hooks load the catalog independently (Models page, chat welcome,
// recommended-model picker). Memoize the in-flight/resolved promises so the
// bundled JSON is fetched and mapped once per session, not once per consumer.
// loadBundledCatalog never rejects (it falls back to FALLBACK_CATALOG) and
// enrichWithDynamicWebllm swallows its own errors, so caching is safe.
let bundledPromise: Promise<ModelEntry[]> | null = null
let fullPromise: Promise<ModelEntry[]> | null = null

export function loadBundledCatalog(): Promise<ModelEntry[]> {
  if (!bundledPromise) bundledPromise = loadBundledCatalogUncached()
  return bundledPromise
}

// Phase 2: replace the bundled WebLLM models with the *current* list discovered
// from the CDN, keeping GGUF models and overlaying our curated metadata. On any
// failure returns the bundled list unchanged, so the caller can call this
// optimistically. `bundled` is the result of loadBundledCatalog().
export async function enrichWithDynamicWebllm(bundled: ModelEntry[]): Promise<ModelEntry[]> {
  try {
    const dynamic = collapseContextVariants(await fetchWebllmModelsFromCdn())
    const curatedByModelId = new Map(
      bundled.filter((m) => m.engine === 'webllm').map((m) => [m.modelId, m])
    )
    const webllmModels = dynamic.map((m) => {
      const curated = curatedByModelId.get(m.modelId)
      return curated ? applyCuration(m, curated) : m
    })
    const ggufModels = bundled.filter((m) => m.engine === 'wllama')
    const combined = deduplicateById([...webllmModels, ...ggufModels])
    return combined.length > 0 ? combined : bundled
  } catch (err) {
    log.warn('Dynamic WebLLM catalog unavailable, keeping bundled list:', err)
    return bundled
  }
}

// Convenience: full catalog (bundled + dynamic) in one await. Memoized so the
// recommended-model hooks share a single load instead of each rebuilding it.
export function loadModelCatalog(): Promise<ModelEntry[]> {
  if (!fullPromise) {
    fullPromise = loadBundledCatalog().then((bundled) => enrichWithDynamicWebllm(bundled))
  }
  return fullPromise
}
