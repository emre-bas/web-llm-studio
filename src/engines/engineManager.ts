import type { LlmEngineAdapter, LoadOptions, GenerateOptions, ChatMessage, EngineStatus } from './base'
import type { ModelEntry } from '../catalog/types'
import { createLogger } from '../utils/logger'

const log = createLogger('EngineManager')

type StateListener = (status: EngineStatus, model: ModelEntry | null) => void

class EngineManager {
  private currentEngine: LlmEngineAdapter | null = null
  private listeners: Set<StateListener> = new Set()
  // Serialises generation. The single-instance WebLLM/Wllama engines corrupt
  // their state if two create() calls overlap, which can happen when a hidden
  // call (TTS language detection) runs while a chat response is streaming. Each
  // generate/generateStream waits for the previous one to finish before starting.
  private generationGate: Promise<void> = Promise.resolve()

  private async acquireGenerationSlot(): Promise<() => void> {
    const previous = this.generationGate
    let release!: () => void
    this.generationGate = new Promise<void>((resolve) => { release = resolve })
    await previous
    return release
  }

  private notify() {
    const status = this.currentEngine?.getStatus() ?? 'idle'
    const model = this.currentEngine?.getLoadedModel() ?? null
    this.listeners.forEach((fn) => fn(status, model))
  }

  subscribe(fn: StateListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private async getOrCreateEngine(engine: ModelEntry['engine']): Promise<LlmEngineAdapter> {
    // Lazily import and instantiate the right engine
    if (engine === 'webllm') {
      const { WebLLMEngine } = await import('./webllmEngine')
      return new WebLLMEngine()
    } else {
      const { WllamaEngine } = await import('./wllamaEngine')
      return new WllamaEngine()
    }
  }

  async load(
    model: ModelEntry,
    options?: LoadOptions & { onProgress?: (pct: number, text: string) => void }
  ): Promise<void> {
    // Unload any existing engine. Abort any in-flight generation first so a
    // model switch mid-response unwinds cleanly — otherwise the streaming loop
    // would keep reading from an engine that's being torn down underneath it.
    if (this.currentEngine?.isLoaded()) {
      this.currentEngine.stop()
      await this.unload()
    }

    log.info('Loading model:', model.id, 'via', model.engine)
    const engine = await this.getOrCreateEngine(model.engine)
    this.currentEngine = engine

    this.notify()

    await engine.load(model, {
      ...options,
      onProgress: (pct, text) => {
        options?.onProgress?.(pct, text)
        this.notify()
      },
    })

    this.notify()
  }

  async unload(): Promise<void> {
    if (!this.currentEngine) return
    log.info('Unloading engine')
    await this.currentEngine.unload()
    this.currentEngine = null
    this.notify()
  }

  async generate(messages: ChatMessage[], options?: GenerateOptions): Promise<string> {
    if (!this.currentEngine?.isLoaded()) throw new Error('No model loaded')
    const release = await this.acquireGenerationSlot()
    try {
      return await this.currentEngine.generate(messages, options)
    } finally {
      release()
    }
  }

  async *generateStream(
    messages: ChatMessage[],
    options?: GenerateOptions
  ): AsyncGenerator<string> {
    if (!this.currentEngine?.isLoaded()) throw new Error('No model loaded')
    const release = await this.acquireGenerationSlot()
    try {
      yield* this.currentEngine.generateStream(messages, options)
    } finally {
      release()
    }
  }

  stop(): void {
    this.currentEngine?.stop()
  }

  isLoaded(): boolean {
    return this.currentEngine?.isLoaded() ?? false
  }

  getStatus(): EngineStatus {
    return this.currentEngine?.getStatus() ?? 'idle'
  }

  getLoadedModel(): ModelEntry | null {
    return this.currentEngine?.getLoadedModel() ?? null
  }

  async checkCache(model: ModelEntry): Promise<boolean> {
    const engine = await this.getOrCreateEngine(model.engine)
    return engine.checkCache(model)
  }

  async deleteCache(model: ModelEntry): Promise<void> {
    const engine = await this.getOrCreateEngine(model.engine)
    return engine.deleteCache(model)
  }
}

// Singleton
export const engineManager = new EngineManager()
