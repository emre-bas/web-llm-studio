export type EngineType = 'webllm' | 'wllama'
export type ModelFormat = 'mlc' | 'gguf'
export type QuantizationType = 'q4f16' | 'q4f32' | 'q4_k_m' | 'q5_k_m' | 'q8_0' | 'fp16' | 'q4_0' | 'other'

export interface ModelEntry {
  id: string
  name: string
  provider: string
  engine: EngineType
  format: ModelFormat
  /** HuggingFace repo, e.g. "HuggingFaceTB/SmolLM2-360M-Instruct" */
  repo: string
  /** Specific file path within the repo (GGUF) */
  file?: string
  /** WebLLM model ID or HF model ID */
  modelId: string
  sizeLabel: string
  estimatedRam: number   // in MB
  estimatedVram: number  // in MB
  quantization: QuantizationType
  parameterSize: string
  architecture: string
  tags: string[]
  recommended: boolean
  experimental: boolean
  disabled: boolean
  description: string
  warnings: string[]
  license: string
  sourceUrl: string
  supportsVision?: boolean
  /** Context window in tokens, when known — drives the chat context-usage meter. */
  contextWindow?: number
}

export interface ModelCatalog {
  version: string
  updatedAt: string
  models: ModelEntry[]
}

export interface ModelFilter {
  search: string
  engines: EngineType[]
  formats: ModelFormat[]
  recommendedOnly: boolean
  includeExperimental: boolean
  excludeDisabled: boolean
  visionOnly: boolean
  isMoe: boolean | null
  quantizations: QuantizationType[]
  maxRamMb: number | null
}

export type SortKey = 'recommended' | 'size' | 'name' | 'engine'

export interface CacheStatus {
  cached: boolean
  checking: boolean
  error?: string
}
