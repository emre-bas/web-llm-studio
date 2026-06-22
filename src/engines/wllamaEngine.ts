import { BaseEngine, contentToText } from './base'
import type { LoadOptions, GenerateOptions, ChatMessage } from './base'
import type { ModelEntry } from '../catalog/types'
import { createLogger } from '../utils/logger'

const log = createLogger('Wllama')

// Map our GenerateOptions to wllama's llama.cpp `sampling` config. Best-effort:
// wllama exposes temp/top_k/top_p/penalty_freq/penalty_present/seed; anything it
// doesn't recognise is simply ignored by the WASM layer. Only defined values are
// included so we don't clobber llama.cpp's own defaults.
function toWllamaSampling(options?: GenerateOptions): Record<string, unknown> {
  const sampling: Record<string, unknown> = {
    temp: options?.temperature ?? 0.7,
  }
  if (typeof options?.topP === 'number') sampling.top_p = options.topP
  if (typeof options?.topK === 'number') sampling.top_k = options.topK
  if (typeof options?.frequencyPenalty === 'number') sampling.penalty_freq = options.frequencyPenalty
  if (typeof options?.presencePenalty === 'number') sampling.penalty_present = options.presencePenalty
  if (typeof options?.seed === 'number') sampling.seed = options.seed
  return sampling
}

// Truncate generated text at the earliest stop sequence. Wllama's `stopTokens`
// works on token IDs, not strings, so stop *strings* are enforced here instead.
function applyStop(text: string, stop?: string[]): string {
  const cut = earliestStop(text, stop)
  return cut >= 0 ? text.slice(0, cut) : text
}

// Index of the earliest stop sequence in `text`, or -1 if none present.
function earliestStop(text: string, stop?: string[]): number {
  let cut = -1
  for (const s of stop ?? []) {
    if (!s) continue
    const idx = text.indexOf(s)
    if (idx >= 0 && (cut === -1 || idx < cut)) cut = idx
  }
  return cut
}

export class WllamaEngine extends BaseEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private wllama: any = null

  async load(model: ModelEntry, options?: LoadOptions): Promise<void> {
    if (this.status === 'loading') throw new Error('Already loading a model')
    if (!model.file) throw new Error('GGUF model requires a file path')

    this.status = 'loading'
    this.loadedModel = null
    this.wllama = null

    try {
      log.info('Dynamically importing @wllama/wllama')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wllamaModule: any = await import('@wllama/wllama')
      const Wllama = wllamaModule.Wllama ?? wllamaModule.default?.Wllama

      if (!Wllama) {
        throw new Error('Failed to load Wllama — class not found in module')
      }

      // Resolve WASM paths via Vite's asset handling
      // The wllama package ships WASM files that need to be served as static assets
      let wasmPath: string
      try {
        wasmPath = new URL('@wllama/wllama/esm/single-thread/wllama.wasm', import.meta.url).href
      } catch {
        wasmPath = '/wllama-single-thread.wasm'
      }
      const CONFIG_PATHS = {
        'single-thread/wllama.wasm': wasmPath,
      }

      const instance = new Wllama(CONFIG_PATHS, {
        logger: {
          debug: (...args: unknown[]) => log.debug(...args),
          log: (...args: unknown[]) => log.info(...args),
          warn: (...args: unknown[]) => log.warn(...args),
          error: (...args: unknown[]) => log.error(...args),
        },
      })

      const hfUrl = `https://huggingface.co/${model.repo}/resolve/main/${model.file}`
      options?.onProgress?.(5, 'Downloading GGUF model from HuggingFace…')

      await instance.loadModelFromUrl(hfUrl, {
        // Wllama's WASM build of llama.cpp has no GPU backend, so GGUF inference
        // is always CPU-only. n_gpu_layers stays 0 (the library ignores it too).
        n_gpu_layers: 0,
        progressCallback: ({ loaded, total }: { loaded: number; total: number }) => {
          if (total > 0) {
            const pct = Math.round((loaded / total) * 90) + 5
            options?.onProgress?.(pct, `Downloading: ${Math.round((loaded / total) * 100)}%`)
          }
        },
      })

      this.wllama = instance
      this.loadedModel = model
      this.status = 'ready'
      options?.onProgress?.(100, 'Model loaded')
      log.info('GGUF model loaded:', model.file)
    } catch (err) {
      this.status = 'error'
      this.wllama = null
      throw err
    }
  }

  async unload(): Promise<void> {
    this.status = 'unloading'
    try {
      await this.wllama?.exit?.()
    } finally {
      this.wllama = null
      this.loadedModel = null
      this.status = 'idle'
    }
  }

  async generate(messages: ChatMessage[], options?: GenerateOptions): Promise<string> {
    if (!this.wllama) throw new Error('No model loaded')
    this.status = 'generating'
    this.abortController = new AbortController()
    try {
      const prompt = messagesToPrompt(messages)
      const result = await this.wllama.createCompletion(prompt, {
        nPredict: options?.maxTokens ?? 512,
        sampling: toWllamaSampling(options),
      })
      const text = typeof result === 'string' ? result : ''
      return applyStop(text, options?.stop)
    } finally {
      this.status = 'ready'
      this.abortController = null
    }
  }

  async *generateStream(
    messages: ChatMessage[],
    options?: GenerateOptions
  ): AsyncGenerator<string> {
    if (!this.wllama) throw new Error('No model loaded')
    this.status = 'generating'
    this.abortController = new AbortController()

    // Bridge the synchronous onNewToken callback to the async generator: push
    // each new fragment into a queue and wake the consumer, so tokens are
    // yielded as they are produced rather than all at once after completion.
    const queue: string[] = []
    let wake: (() => void) | null = null
    let finished = false
    let failure: unknown = null
    let lastLen = 0

    const stops = options?.stop?.filter(Boolean) ?? []

    const completion = this.wllama
      .createCompletion(messagesToPrompt(messages), {
        nPredict: options?.maxTokens ?? 512,
        sampling: toWllamaSampling(options),
        onNewToken: (_token: number, _piece: Uint8Array, currentText: string) => {
          if (this.abortController?.signal.aborted) return 1 // ABORT
          // Enforce stop sequences (strings) by truncating at the earliest match
          // and aborting once it appears.
          const cut = stops.length > 0 ? earliestStop(currentText, stops) : -1
          const text = cut >= 0 ? currentText.slice(0, cut) : currentText
          const newPart = text.slice(lastLen)
          lastLen = text.length
          if (newPart) {
            queue.push(newPart)
            wake?.()
            wake = null
          }
          return cut >= 0 ? 1 : 0 // ABORT once a stop sequence is hit
        },
      })
      .catch((err: unknown) => { failure = err })
      .finally(() => {
        finished = true
        wake?.()
        wake = null
      })

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!
          continue
        }
        if (finished) break
        await new Promise<void>((resolve) => { wake = resolve })
      }
      await completion
      if (failure) throw failure
    } finally {
      this.status = 'ready'
      this.abortController = null
    }
  }

  async checkCache(_model: ModelEntry): Promise<boolean> {
    // Wllama doesn't expose a cache inspection API yet
    return false
  }

  async deleteCache(_model: ModelEntry): Promise<void> {
    throw new Error(
      'Cache deletion is not supported for GGUF models via Wllama. ' +
      'Clear browser storage manually via DevTools → Application → Cache Storage.'
    )
  }
}

function messagesToPrompt(messages: ChatMessage[]): string {
  // ChatML-style format used by most instruct-tuned GGUF models
  const parts: string[] = []
  for (const msg of messages) {
    const text = contentToText(msg.content)
    if (msg.role === 'system') {
      parts.push(`<|system|>\n${text}\n`)
    } else if (msg.role === 'user') {
      parts.push(`<|user|>\n${text}\n`)
    } else {
      parts.push(`<|assistant|>\n${text}\n`)
    }
  }
  parts.push('<|assistant|>\n')
  return parts.join('')
}
