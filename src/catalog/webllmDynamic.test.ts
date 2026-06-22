import { describe, it, expect } from 'vitest'
import { recordToEntry, type ModelRecord } from './webllmDynamic'

function record(overrides: Partial<ModelRecord> = {}): ModelRecord {
  return {
    model: 'https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC',
    model_id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    vram_required_MB: 1128,
    ...overrides,
  }
}

describe('recordToEntry', () => {
  it('maps the core identity fields and lowercases the id', () => {
    const e = recordToEntry(record())
    expect(e.id).toBe('llama-3.2-1b-instruct-q4f16_1-mlc')
    expect(e.modelId).toBe('Llama-3.2-1B-Instruct-q4f16_1-MLC')
    expect(e.engine).toBe('webllm')
    expect(e.format).toBe('mlc')
  })

  it('derives a friendly name by stripping the MLC and quant suffixes', () => {
    expect(recordToEntry(record()).name).toBe('Llama 3.2 1B Instruct')
  })

  it('infers the provider from known id keywords', () => {
    expect(recordToEntry(record({ model_id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC' })).provider).toBe('Alibaba')
    expect(recordToEntry(record({ model_id: 'Phi-3-mini-4k-instruct-q4f16_1-MLC' })).provider).toBe('Microsoft')
    expect(recordToEntry(record({ model_id: 'gemma-2-2b-it-q4f16_1-MLC' })).provider).toBe('Google')
  })

  it('falls back to "MLC" for an unrecognised provider', () => {
    expect(recordToEntry(record({ model_id: 'SomeUnknownModel-q4f16_1-MLC' })).provider).toBe('MLC')
  })

  it('detects the quantization from the id', () => {
    expect(recordToEntry(record({ model_id: 'X-q4f32_1-MLC' })).quantization).toBe('q4f32')
    expect(recordToEntry(record({ model_id: 'X-q4f16_1-MLC' })).quantization).toBe('q4f16')
    expect(recordToEntry(record({ model_id: 'X-no-quant-MLC' })).quantization).toBe('other')
  })

  it('extracts the parameter size, or "—" when absent', () => {
    expect(recordToEntry(record({ model_id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC' })).parameterSize).toBe('1B')
    expect(recordToEntry(record({ model_id: 'gemma-2-2b-it-q4f16_1-MLC' })).parameterSize).toBe('2B')
    expect(recordToEntry(record({ model_id: 'embed-model-q0f32-MLC' })).parameterSize).toBe('—')
  })

  it('formats the size label from VRAM in MB/GB, or "—" when zero', () => {
    expect(recordToEntry(record({ vram_required_MB: 512 })).sizeLabel).toBe('~512 MB')
    expect(recordToEntry(record({ vram_required_MB: 1536 })).sizeLabel).toBe('~1.5 GB')
    expect(recordToEntry(record({ vram_required_MB: 0 })).sizeLabel).toBe('—')
  })

  it('mirrors VRAM into estimatedRam and estimatedVram, defaulting to 0', () => {
    const e = recordToEntry(record({ vram_required_MB: 1128 }))
    expect(e.estimatedRam).toBe(1128)
    expect(e.estimatedVram).toBe(1128)
    const missing = recordToEntry(record({ vram_required_MB: undefined }))
    expect(missing.estimatedRam).toBe(0)
    expect(missing.sizeLabel).toBe('—')
  })

  it('tags low-resource models as "small"', () => {
    expect(recordToEntry(record({ low_resource_required: true })).tags).toEqual(['small'])
    expect(recordToEntry(record({ low_resource_required: false })).tags).toEqual([])
  })

  it('derives the repo from the HuggingFace model URL, not the model_id', () => {
    // model_id can carry suffixes (e.g. "-b4") that are not part of the repo path;
    // cache detection keys off the repo, so it must come from the URL.
    const e = recordToEntry(record({
      model: 'https://huggingface.co/mlc-ai/snowflake-arctic-embed-m-q0f32-MLC',
      model_id: 'snowflake-arctic-embed-m-q0f32-MLC-b4',
    }))
    expect(e.repo).toBe('mlc-ai/snowflake-arctic-embed-m-q0f32-MLC')
  })

  it('falls back to an mlc-ai/<id> repo when the URL is missing or unparseable', () => {
    const e = recordToEntry(record({ model: undefined, model_id: 'Some-Model-MLC' }))
    expect(e.repo).toBe('mlc-ai/Some-Model-MLC')
  })

  it('enables vision only for allowlisted models, not on keyword guesses', () => {
    expect(recordToEntry(record({ model_id: 'Phi-3.5-vision-instruct-q4f16_1-MLC' })).supportsVision).toBe(true)
    // "llava" / "vision" in the id alone must NOT flip the flag (avoids false positives).
    expect(recordToEntry(record({ model_id: 'llava-1.5-7b-hf-q4f16_1-MLC' })).supportsVision).toBe(false)
    expect(recordToEntry(record()).supportsVision).toBe(false)
  })

  it('includes contextWindow only when positive, preferring overrides', () => {
    expect(recordToEntry(record({ context_window_size: 4096 })).contextWindow).toBe(4096)
    // overrides win over the base field…
    expect(
      recordToEntry(record({ context_window_size: 4096, overrides: { context_window_size: 2048 } })).contextWindow
    ).toBe(2048)
    // …and a missing/zero window omits the field entirely.
    expect(recordToEntry(record()).contextWindow).toBeUndefined()
    expect(recordToEntry(record({ context_window_size: 0 })).contextWindow).toBeUndefined()
  })

  it('uses the model URL as the sourceUrl, falling back to a HF repo link', () => {
    expect(recordToEntry(record()).sourceUrl).toBe(
      'https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC'
    )
    expect(recordToEntry(record({ model: undefined, model_id: 'Some-Model-MLC' })).sourceUrl).toBe(
      'https://huggingface.co/mlc-ai/Some-Model-MLC'
    )
  })

  it('defaults curated flags off so the dynamic list is neutral until enriched', () => {
    const e = recordToEntry(record())
    expect(e.recommended).toBe(false)
    expect(e.experimental).toBe(false)
    expect(e.disabled).toBe(false)
    expect(e.architecture).toBe('')
  })
})
