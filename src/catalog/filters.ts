import type { ModelEntry, ModelFilter, SortKey } from './types'

export function applyFilters(models: ModelEntry[], filter: ModelFilter): ModelEntry[] {
  let result = [...models]

  if (filter.excludeDisabled) {
    result = result.filter((m) => !m.disabled)
  }

  if (filter.recommendedOnly) {
    result = result.filter((m) => m.recommended)
  }

  if (!filter.includeExperimental) {
    result = result.filter((m) => !m.experimental)
  }

  if (filter.visionOnly) {
    result = result.filter((m) => m.supportsVision)
  }

  if (filter.engines.length > 0) {
    result = result.filter((m) => filter.engines.includes(m.engine))
  }

  if (filter.formats.length > 0) {
    result = result.filter((m) => filter.formats.includes(m.format))
  }

  if (filter.isMoe !== null) {
    result = result.filter((m) =>
      filter.isMoe
        ? m.tags.includes('moe') || m.architecture.toLowerCase().includes('moe')
        : !m.tags.includes('moe') && !m.architecture.toLowerCase().includes('moe')
    )
  }

  if (filter.quantizations.length > 0) {
    result = result.filter((m) => filter.quantizations.includes(m.quantization))
  }

  if (filter.maxRamMb !== null) {
    result = result.filter((m) => m.estimatedRam <= filter.maxRamMb!)
  }

  if (filter.search.trim()) {
    const q = filter.search.toLowerCase()
    result = result.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        m.architecture.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
    )
  }

  return result
}

export function sortModels(models: ModelEntry[], sortKey: SortKey): ModelEntry[] {
  return [...models].sort((a, b) => {
    switch (sortKey) {
      case 'recommended':
        if (a.recommended !== b.recommended) return a.recommended ? -1 : 1
        if (a.experimental !== b.experimental) return a.experimental ? 1 : -1
        return a.estimatedRam - b.estimatedRam

      case 'size':
        return a.estimatedRam - b.estimatedRam

      case 'name':
        return a.name.localeCompare(b.name)

      case 'engine':
        return a.engine.localeCompare(b.engine)

      default:
        return 0
    }
  })
}

export const DEFAULT_FILTER: ModelFilter = {
  search: '',
  engines: [],
  formats: [],
  recommendedOnly: false,
  includeExperimental: true,
  excludeDisabled: true,
  visionOnly: false,
  isMoe: null,
  quantizations: [],
  maxRamMb: null,
}
