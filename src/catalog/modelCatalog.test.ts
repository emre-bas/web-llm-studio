import { describe, it, expect } from 'vitest'
import { collapseContextVariants } from './modelCatalog'
import type { ModelEntry } from './types'

function model(modelId: string, overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: modelId.toLowerCase(), name: modelId, provider: 'Provider', engine: 'webllm',
    format: 'mlc', repo: 'org/repo', modelId, sizeLabel: '~1 GB',
    estimatedRam: 1000, estimatedVram: 1000, quantization: 'q4f16',
    parameterSize: '1B', architecture: 'LlamaForCausalLM', tags: [],
    recommended: false, experimental: false, disabled: false,
    description: '', warnings: [], license: '', sourceUrl: '',
    ...overrides,
  }
}

describe('collapseContextVariants', () => {
  it('collapses a reduced-context variant into the full-context one', () => {
    const models = [
      model('gemma-2-2b-it-q4f16_1-MLC'),
      model('gemma-2-2b-it-q4f16_1-MLC-1k'),
    ]
    expect(collapseContextVariants(models).map((m) => m.modelId)).toEqual([
      'gemma-2-2b-it-q4f16_1-MLC',
    ])
  })

  it('keeps the full-context variant regardless of input order', () => {
    const models = [
      model('Llama-3.2-1B-Instruct-q4f16_1-MLC-1k'),
      model('Llama-3.2-1B-Instruct-q4f16_1-MLC'),
    ]
    expect(collapseContextVariants(models).map((m) => m.modelId)).toEqual([
      'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    ])
  })

  it('does NOT collapse distinct quantizations of the same base model', () => {
    const models = [
      model('gemma-2-2b-it-q4f16_1-MLC'),
      model('gemma-2-2b-it-q4f32_1-MLC'),
    ]
    expect(collapseContextVariants(models)).toHaveLength(2)
  })

  it('keeps the largest window when only reduced variants exist', () => {
    const models = [
      model('Phi-3-mini-instruct-q4f16_1-MLC-1k'),
      model('Phi-3-mini-instruct-q4f16_1-MLC-4k'),
    ]
    expect(collapseContextVariants(models).map((m) => m.modelId)).toEqual([
      'Phi-3-mini-instruct-q4f16_1-MLC-4k',
    ])
  })

  it('leaves unrelated models and non-context suffixes (e.g. -b4) untouched', () => {
    const models = [
      model('snowflake-arctic-embed-m-q0f32-MLC-b4'),
      model('snowflake-arctic-embed-m-q0f32-MLC-b32'),
      model('Qwen2.5-0.5B-Instruct-q4f16_1-MLC'),
    ]
    expect(collapseContextVariants(models).map((m) => m.modelId)).toEqual([
      'snowflake-arctic-embed-m-q0f32-MLC-b4',
      'snowflake-arctic-embed-m-q0f32-MLC-b32',
      'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    ])
  })
})
