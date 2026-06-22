import type { ModelEntry, QuantizationType } from './types'
import { createLogger } from '../utils/logger'

const log = createLogger('WebLLMDynamic')

// Pinned to major 0.x via esm.sh so the list reflects the *current* WebLLM
// release whenever the page is opened — not the version frozen into this build.
// Minor/patch updates (new models) flow in; breaking majors do not. The engine
// (webllmEngine.ts) imports the same URL so the list and the runtime stay in sync.
export const WEBLLM_CDN_URL = 'https://esm.sh/@mlc-ai/web-llm@0'
const CDN_URL = WEBLLM_CDN_URL
const TIMEOUT_MS = 30000 // first (cold) CDN build can take ~25s; cached after
const CACHE_KEY = 'wls-webllm-models-v2' // v2: added contextWindow
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // refresh the list at most once a day

// Shape of a WebLLM prebuilt model record (only the fields we use).
export interface ModelRecord {
  model: string
  model_id: string
  vram_required_MB?: number
  low_resource_required?: boolean
  context_window_size?: number
  overrides?: { context_window_size?: number }
}

function paramSize(id: string): string {
  const m = id.match(/(\d+(?:\.\d+)?)\s*B/i)
  return m ? `${m[1]}B` : '—'
}

function quantization(id: string): QuantizationType {
  if (/q4f16/i.test(id)) return 'q4f16'
  if (/q4f32/i.test(id)) return 'q4f32'
  if (/q4_k_m/i.test(id)) return 'q4_k_m'
  if (/q5_k_m/i.test(id)) return 'q5_k_m'
  if (/q8_0/i.test(id)) return 'q8_0'
  if (/q4_0/i.test(id)) return 'q4_0'
  if (/fp16|f16/i.test(id)) return 'fp16'
  return 'other'
}

function friendlyName(id: string): string {
  return id
    .replace(/-MLC(-.*)?$/i, '') // drop "-MLC" and anything trailing
    .replace(/-q\d.*$/i, '')     // drop quant suffix e.g. "-q4f16_1"
    .replace(/[-_]/g, ' ')
    .trim()
}

const PROVIDERS: [RegExp, string][] = [
  [/llama|llava/i, 'Meta'],
  [/qwen/i, 'Alibaba'],
  [/phi/i, 'Microsoft'],
  [/gemma/i, 'Google'],
  [/mistral/i, 'Mistral AI'],
  [/smollm/i, 'HuggingFace'],
  [/deepseek/i, 'DeepSeek'],
  [/hermes/i, 'Nous Research'],
  [/redpajama/i, 'Together'],
  [/tinyllama/i, 'TinyLlama'],
  [/stablelm/i, 'Stability AI'],
]

function provider(id: string): string {
  for (const [re, name] of PROVIDERS) if (re.test(id)) return name
  return 'MLC'
}

// WebLLM's `model` field is the HuggingFace repo URL that actually holds the
// weights; `model_id` is a separate identifier that can append suffixes (e.g.
// the embedding batch-size variants "-b4"/"-b32") which are NOT part of the repo
// path. Cache detection keys off the repo, so derive the repo from `model`
// rather than assuming it equals `model_id` — otherwise these models always read
// as "Not cached" even after download.
function repoFromModelUrl(url: string | undefined, fallbackId: string): string {
  const m = url?.match(/huggingface\.co\/([^/]+\/[^/?#]+)/i)
  return m ? m[1] : `mlc-ai/${fallbackId}`
}

function sizeLabel(vram: number): string {
  if (!vram) return '—'
  return vram >= 1024 ? `~${(vram / 1024).toFixed(1)} GB` : `~${vram} MB`
}

// Models the bundled WebLLM engine actually supports for image input. An id
// keyword guess (vision|vlm|llava) both mislabels models — a false positive
// enables the photo flow on a model that then errors — and misses real VLMs, so
// use an explicit allowlist instead. Add patterns here as WebLLM gains support;
// curated bundled catalog entries can still set supportsVision directly.
const VISION_MODEL_PATTERNS: RegExp[] = [/phi-3\.5-vision/i]
function detectVision(id: string): boolean {
  return VISION_MODEL_PATTERNS.some((re) => re.test(id))
}

// Exported for unit testing — pure mapping from a CDN record to a catalog entry.
export function recordToEntry(r: ModelRecord): ModelEntry {
  const id = r.model_id
  const vram = r.vram_required_MB ?? 0
  const vision = detectVision(id)
  const repo = repoFromModelUrl(r.model, id)
  const contextWindow = r.overrides?.context_window_size ?? r.context_window_size
  return {
    id: id.toLowerCase(),
    name: friendlyName(id),
    provider: provider(id),
    engine: 'webllm',
    format: 'mlc',
    repo,
    modelId: id,
    sizeLabel: sizeLabel(vram),
    estimatedRam: vram || 0,
    estimatedVram: vram || 0,
    quantization: quantization(id),
    parameterSize: paramSize(id),
    architecture: '',
    tags: r.low_resource_required ? ['small'] : [],
    recommended: false,
    experimental: false,
    disabled: false,
    description: `${friendlyName(id)} — runs in the browser via WebLLM (WebGPU).`,
    warnings: [],
    license: '',
    sourceUrl: r.model || `https://huggingface.co/${repo}`,
    supportsVision: vision,
    ...(contextWindow && contextWindow > 0 ? { contextWindow } : {}),
  }
}

function readCache(): { ts: number; models: ModelEntry[] } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { ts: number; models: ModelEntry[] }
    if (!parsed || !Array.isArray(parsed.models)) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(models: ModelEntry[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), models }))
  } catch { /* quota / disabled storage — non-fatal */ }
}

// Fetch the current WebLLM model list from the CDN-hosted package. Uses a daily
// localStorage cache so only the first-ever visit pays the cold-build latency.
// Rejects on failure (with no usable cache) so the caller can fall back to the
// bundled catalog.
export async function fetchWebllmModelsFromCdn(): Promise<ModelEntry[]> {
  const cached = readCache()
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS && cached.models.length > 0) {
    log.info(`Using cached WebLLM model list (${cached.models.length})`)
    return cached.models
  }

  try {
    const url = CDN_URL // variable specifier → not statically resolved by the bundler
    const mod = (await Promise.race([
      import(/* @vite-ignore */ url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('CDN import timeout')), TIMEOUT_MS)),
    ])) as { prebuiltAppConfig?: { model_list?: ModelRecord[] } }

    const list = mod?.prebuiltAppConfig?.model_list
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error('prebuiltAppConfig.model_list missing or empty')
    }
    log.info(`Loaded ${list.length} WebLLM models from CDN`)
    const models = list.filter((r) => r && typeof r.model_id === 'string').map(recordToEntry)
    writeCache(models)
    return models
  } catch (err) {
    // Network/CDN failure — serve a stale cache if we have one.
    if (cached && cached.models.length > 0) {
      log.warn('CDN fetch failed; using stale cached list:', err)
      return cached.models
    }
    throw err
  }
}
