import type { ModelEntry } from '../catalog/types'

export type EngineStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'generating'
  | 'error'
  | 'unloading'

export interface LoadOptions {
  onProgress?: (progress: number, text: string) => void
  cacheBackend?: 'cache-api' | 'indexeddb' | 'opfs'
}

export interface GenerateOptions {
  temperature?: number
  maxTokens?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  /** Seed for deterministic sampling. Same seed + same params → same output. */
  seed?: number
  /** Stop sequences — generation halts when any is produced. */
  stop?: string[]
  signal?: AbortSignal
}

// Multimodal content parts (OpenAI-compatible). Vision models accept an array
// of text + image parts; text-only engines flatten it back to a string.
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

// Flatten multimodal content to plain text — used by engines without vision
// support (e.g. Wllama) so image parts are dropped rather than stringified.
export function contentToText(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
}

export interface LlmEngineAdapter {
  load(model: ModelEntry, options?: LoadOptions): Promise<void>
  unload(): Promise<void>
  generate(messages: ChatMessage[], options?: GenerateOptions): Promise<string>
  generateStream(
    messages: ChatMessage[],
    options?: GenerateOptions
  ): AsyncGenerator<string>
  stop(): void
  isLoaded(): boolean
  getStatus(): EngineStatus
  getLoadedModel(): ModelEntry | null
  checkCache(model: ModelEntry): Promise<boolean>
  deleteCache(model: ModelEntry): Promise<void>
}

export abstract class BaseEngine implements LlmEngineAdapter {
  protected status: EngineStatus = 'idle'
  protected loadedModel: ModelEntry | null = null
  protected abortController: AbortController | null = null

  abstract load(model: ModelEntry, options?: LoadOptions): Promise<void>
  abstract unload(): Promise<void>
  abstract generate(messages: ChatMessage[], options?: GenerateOptions): Promise<string>
  abstract generateStream(
    messages: ChatMessage[],
    options?: GenerateOptions
  ): AsyncGenerator<string>

  stop(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    if (this.status === 'generating') {
      this.status = 'ready'
    }
  }

  isLoaded(): boolean {
    return this.status === 'ready' || this.status === 'generating'
  }

  getStatus(): EngineStatus {
    return this.status
  }

  getLoadedModel(): ModelEntry | null {
    return this.loadedModel
  }

  async checkCache(_model: ModelEntry): Promise<boolean> {
    return false
  }

  async deleteCache(_model: ModelEntry): Promise<void> {
    // no-op by default
  }
}
