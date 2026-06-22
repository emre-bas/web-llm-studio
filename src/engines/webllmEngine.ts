import { BaseEngine } from './base'
import type { LoadOptions, GenerateOptions, ChatMessage } from './base'
import type { ModelEntry } from '../catalog/types'
import { createLogger } from '../utils/logger'

const log = createLogger('WebLLM')

// Typed loosely because webllm types may vary by version
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWebLLM = any

// WebLLM's own cache backend identifiers differ from our setting's values.
type WebllmCacheBackend = 'cache' | 'indexeddb' | 'opfs'
const ALL_CACHE_BACKENDS: WebllmCacheBackend[] = ['cache', 'indexeddb', 'opfs']

function toWebllmCacheBackend(backend?: string): WebllmCacheBackend {
  if (backend === 'indexeddb') return 'indexeddb'
  if (backend === 'opfs') return 'opfs'
  return 'cache' // 'cache-api' and anything unknown → default Cache API
}

// Map our GenerateOptions to WebLLM's OpenAI-compatible completion params.
// Only non-empty `stop` and a defined `seed` are forwarded so we don't override
// the model's defaults with undefined.
function toWebllmParams(options?: GenerateOptions): Record<string, unknown> {
  const params: Record<string, unknown> = {
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 1024,
    top_p: options?.topP ?? 0.95,
    frequency_penalty: options?.frequencyPenalty ?? 0,
    presence_penalty: options?.presencePenalty ?? 0,
  }
  if (typeof options?.seed === 'number') params.seed = options.seed
  if (options?.stop && options.stop.length > 0) params.stop = options.stop
  return params
}

// Some models ship an mlc-chat-config.json that sets BOTH context_window_size
// and sliding_window_size to positive values, which WebLLM rejects at load with
// "Only one of context_window_size and sliding_window_size can be positive".
// The Gemma 3 family is the known offender (e.g. context 4096 + sliding 512).
// The documented workaround is to override one to -1; we disable the sliding
// window so the full context window is preserved. Returns per-model `reload`
// overrides (ChatOptions), or undefined when no fix is needed.
function loadOverridesFor(modelId: string): Record<string, unknown> | undefined {
  if (/gemma-?3/i.test(modelId)) {
    return { sliding_window_size: -1 }
  }
  return undefined
}

export class WebLLMEngine extends BaseEngine {
  private engine: AnyWebLLM = null
  private webllm: AnyWebLLM = null

  // The runtime is intentionally BUNDLED, not CDN-loaded: WebLLM runs inference
  // in a Web Worker with WASM, which fails cross-origin when the library is
  // imported from a CDN (worker/WASM URLs resolve to the CDN origin and stall).
  // The model *list* is still fetched live (see webllmDynamic.ts); only the
  // engine is pinned to this build.
  private async getWebllm(): Promise<AnyWebLLM> {
    if (!this.webllm) {
      log.info('Dynamically importing @mlc-ai/web-llm (bundled)')
      this.webllm = await import('@mlc-ai/web-llm')
    }
    return this.webllm
  }

  async load(model: ModelEntry, options?: LoadOptions): Promise<void> {
    if (this.status === 'loading') throw new Error('Already loading a model')

    this.status = 'loading'
    this.loadedModel = null
    this.engine = null

    try {
      await this.getWebllm()

      // WebLLM runs exclusively on WebGPU (no CPU fallback), so verify it is
      // available up front and surface a friendly error instead of a cryptic
      // internal failure during reload().
      const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } }
      if (!nav.gpu) {
        throw new Error(
          'WebGPU is not available in this browser. ' +
          'Please use Chrome 113+ or another WebGPU-enabled browser.'
        )
      }
      const adapter = await nav.gpu.requestAdapter()
      if (!adapter) {
        throw new Error(
          'No WebGPU adapter found. Your GPU or browser may not support WebGPU. ' +
          'Try Chrome 113+ on a device with a supported GPU.'
        )
      }

      const { MLCEngine, prebuiltAppConfig } = this.webllm as {
        MLCEngine: new (opts: AnyWebLLM) => AnyWebLLM
        prebuiltAppConfig: AnyWebLLM
      }

      // Route downloads to the storage backend chosen in Settings. WebLLM reads
      // this off appConfig.cacheBackend; without it everything defaults to the
      // Cache API regardless of the setting.
      const appConfig = {
        ...prebuiltAppConfig,
        cacheBackend: toWebllmCacheBackend(options?.cacheBackend),
      }

      const mlcEngine = new MLCEngine({
        appConfig,
        initProgressCallback: (progress: { progress?: number; text?: string }) => {
          const pct = Math.round((progress.progress ?? 0) * 100)
          options?.onProgress?.(pct, progress.text ?? '')
          log.debug('Load progress:', pct, progress.text)
        },
      })

      const overrides = loadOverridesFor(model.modelId)
      await mlcEngine.reload(model.modelId, overrides)
      this.engine = mlcEngine
      this.loadedModel = model
      this.status = 'ready'
      options?.onProgress?.(100, 'Model loaded successfully')
      log.info('Model loaded:', model.modelId)
    } catch (err) {
      this.status = 'error'
      this.engine = null
      throw err
    }
  }

  async unload(): Promise<void> {
    this.status = 'unloading'
    try {
      await this.engine?.unload()
    } finally {
      this.engine = null
      this.loadedModel = null
      this.status = 'idle'
    }
  }

  async generate(messages: ChatMessage[], options?: GenerateOptions): Promise<string> {
    if (!this.engine) throw new Error('No model loaded')
    this.status = 'generating'
    this.abortController = new AbortController()
    try {
      const response = await this.engine.chat.completions.create({
        messages,
        ...toWebllmParams(options),
        stream: false,
      })
      return (response.choices[0]?.message?.content as string | undefined) ?? ''
    } finally {
      this.status = 'ready'
      this.abortController = null
    }
  }

  async *generateStream(
    messages: ChatMessage[],
    options?: GenerateOptions
  ): AsyncGenerator<string> {
    if (!this.engine) throw new Error('No model loaded')
    this.status = 'generating'
    this.abortController = new AbortController()

    try {
      const stream = await this.engine.chat.completions.create({
        messages,
        ...toWebllmParams(options),
        stream: true,
      })

      for await (const chunk of stream) {
        if (this.abortController?.signal.aborted) break
        const delta = chunk.choices[0]?.delta?.content as string | undefined
        if (delta) yield delta
      }
    } finally {
      this.status = 'ready'
      this.abortController = null
    }
  }

  async checkCache(model: ModelEntry): Promise<boolean> {
    try {
      await this.getWebllm()
      const fn = (this.webllm as Record<string, unknown>).hasModelInCache
      if (typeof fn !== 'function') return false
      return await (fn as (id: string) => Promise<boolean>)(model.modelId)
    } catch {
      return false
    }
  }

  async deleteCache(model: ModelEntry): Promise<void> {
    await this.getWebllm()
    const mod = this.webllm as Record<string, unknown>
    // The cache-deletion API has been renamed across WebLLM versions. Current
    // builds export `deleteModelAllInfoInCache` (weights + wasm + config);
    // older ones exposed `deleteModelAllFiles`. Use whichever is present.
    const fn = (mod.deleteModelAllInfoInCache ?? mod.deleteModelAllFiles) as
      | ((id: string, appConfig?: unknown) => Promise<void>)
      | undefined
    if (typeof fn !== 'function') {
      throw new Error('No cache-deletion API available in this version of WebLLM')
    }

    // The user can switch cache backends, so a model may have been downloaded
    // into any of them. Delete from all three; ignore per-backend failures
    // (nothing-to-delete throws) and only surface an error if every one failed.
    const prebuilt = mod.prebuiltAppConfig as { model_list: unknown[] } | undefined
    let anySucceeded = false
    let lastError: unknown = null
    for (const backend of ALL_CACHE_BACKENDS) {
      try {
        const appConfig = prebuilt ? { ...prebuilt, cacheBackend: backend } : undefined
        await fn(model.modelId, appConfig)
        anySucceeded = true
      } catch (err) {
        lastError = err
      }
    }
    if (!anySucceeded && lastError) {
      log.error('Failed to delete cache:', lastError)
      throw lastError
    }
  }
}
