import { describe, it, expect } from 'vitest'
import { applyFilters, sortModels, DEFAULT_FILTER } from './filters'
import type { ModelEntry, ModelFilter } from './types'

function model(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: 'm', name: 'Model', provider: 'Provider', engine: 'webllm', format: 'mlc',
    repo: 'org/repo', modelId: 'Model-id', sizeLabel: '~1 GB',
    estimatedRam: 1000, estimatedVram: 1000, quantization: 'q4f16',
    parameterSize: '1B', architecture: 'LlamaForCausalLM', tags: [],
    recommended: false, experimental: false, disabled: false,
    description: '', warnings: [], license: '', sourceUrl: '',
    ...overrides,
  }
}

function filter(overrides: Partial<ModelFilter> = {}): ModelFilter {
  return { ...DEFAULT_FILTER, ...overrides }
}

describe('DEFAULT_FILTER', () => {
  it('shows experimental and hides disabled by default', () => {
    expect(DEFAULT_FILTER.includeExperimental).toBe(true)
    expect(DEFAULT_FILTER.excludeDisabled).toBe(true)
    expect(DEFAULT_FILTER.quantizations).toEqual([])
    expect(DEFAULT_FILTER.maxRamMb).toBeNull()
  })
})

describe('applyFilters', () => {
  it('excludes disabled models when excludeDisabled is set', () => {
    const models = [model({ id: 'a' }), model({ id: 'b', disabled: true })]
    expect(applyFilters(models, filter()).map((m) => m.id)).toEqual(['a'])
  })

  it('includes disabled models when excludeDisabled is false', () => {
    const models = [model({ id: 'a' }), model({ id: 'b', disabled: true })]
    expect(applyFilters(models, filter({ excludeDisabled: false }))).toHaveLength(2)
  })

  it('filters experimental out only when includeExperimental is false', () => {
    const models = [model({ id: 'a' }), model({ id: 'b', experimental: true })]
    expect(applyFilters(models, filter()).map((m) => m.id)).toEqual(['a', 'b'])
    expect(applyFilters(models, filter({ includeExperimental: false })).map((m) => m.id)).toEqual(['a'])
  })

  it('keeps only recommended when recommendedOnly is set', () => {
    const models = [model({ id: 'a', recommended: true }), model({ id: 'b' })]
    expect(applyFilters(models, filter({ recommendedOnly: true })).map((m) => m.id)).toEqual(['a'])
  })

  it('keeps only vision models when visionOnly is set', () => {
    const models = [model({ id: 'a', supportsVision: true }), model({ id: 'b' })]
    expect(applyFilters(models, filter({ visionOnly: true })).map((m) => m.id)).toEqual(['a'])
  })

  it('filters by engine and format', () => {
    const models = [
      model({ id: 'a', engine: 'webllm', format: 'mlc' }),
      model({ id: 'b', engine: 'wllama', format: 'gguf' }),
    ]
    expect(applyFilters(models, filter({ engines: ['wllama'] })).map((m) => m.id)).toEqual(['b'])
    expect(applyFilters(models, filter({ formats: ['mlc'] })).map((m) => m.id)).toEqual(['a'])
  })

  it('filters MoE via tags or architecture', () => {
    const models = [
      model({ id: 'a', tags: ['moe'] }),
      model({ id: 'b', architecture: 'MixtralMoeForCausalLM' }),
      model({ id: 'c' }),
    ]
    expect(applyFilters(models, filter({ isMoe: true })).map((m) => m.id)).toEqual(['a', 'b'])
    expect(applyFilters(models, filter({ isMoe: false })).map((m) => m.id)).toEqual(['c'])
  })

  it('filters by quantization and max RAM', () => {
    const models = [
      model({ id: 'a', quantization: 'q4f16', estimatedRam: 800 }),
      model({ id: 'b', quantization: 'q4f32', estimatedRam: 3000 }),
    ]
    expect(applyFilters(models, filter({ quantizations: ['q4f16'] })).map((m) => m.id)).toEqual(['a'])
    expect(applyFilters(models, filter({ maxRamMb: 1024 })).map((m) => m.id)).toEqual(['a'])
  })

  it('searches across name, provider, architecture, description, and tags', () => {
    const models = [
      model({ id: 'a', name: 'Gemma 2' }),
      model({ id: 'b', provider: 'Microsoft' }),
      model({ id: 'c', tags: ['vision'] }),
      model({ id: 'd', name: 'Nothing' }),
    ]
    expect(applyFilters(models, filter({ search: 'gemma' })).map((m) => m.id)).toEqual(['a'])
    expect(applyFilters(models, filter({ search: 'microsoft' })).map((m) => m.id)).toEqual(['b'])
    expect(applyFilters(models, filter({ search: 'vision' })).map((m) => m.id)).toEqual(['c'])
  })
})

describe('sortModels', () => {
  it('sorts by name A–Z', () => {
    const models = [model({ id: 'c', name: 'Charlie' }), model({ id: 'a', name: 'Alpha' })]
    expect(sortModels(models, 'name').map((m) => m.name)).toEqual(['Alpha', 'Charlie'])
  })

  it('sorts by size (smallest RAM first)', () => {
    const models = [model({ id: 'big', estimatedRam: 4000 }), model({ id: 'small', estimatedRam: 500 })]
    expect(sortModels(models, 'size').map((m) => m.id)).toEqual(['small', 'big'])
  })

  it('puts recommended first, then non-experimental, then by RAM', () => {
    const models = [
      model({ id: 'exp', experimental: true, estimatedRam: 100 }),
      model({ id: 'rec', recommended: true, estimatedRam: 2000 }),
      model({ id: 'plain', estimatedRam: 1500 }),
    ]
    expect(sortModels(models, 'recommended').map((m) => m.id)).toEqual(['rec', 'plain', 'exp'])
  })

  it('does not mutate the input array', () => {
    const models = [model({ id: 'b', name: 'B' }), model({ id: 'a', name: 'A' })]
    const before = models.map((m) => m.id)
    sortModels(models, 'name')
    expect(models.map((m) => m.id)).toEqual(before)
  })
})
