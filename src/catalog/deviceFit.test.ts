import { describe, it, expect } from 'vitest'
import { fitsDevice } from './deviceFit'
import type { ModelEntry } from './types'
import type { DeviceProfile } from '../hooks/useDeviceProfile'

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

function profile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    deviceMemoryMb: undefined,
    webGpuSupported: true,
    webGpuChecking: false,
    mobile: false,
    ...overrides,
  }
}

describe('fitsDevice', () => {
  it('stays permissive when no signals are available', () => {
    expect(fitsDevice(model(), profile())).toBe(true)
  })

  it('rejects WebLLM models when WebGPU is confirmed unavailable', () => {
    expect(fitsDevice(model({ engine: 'webllm' }), profile({ webGpuSupported: false }))).toBe(false)
  })

  it('does not reject on WebGPU while detection is still in flight', () => {
    expect(
      fitsDevice(model({ engine: 'webllm' }), profile({ webGpuSupported: false, webGpuChecking: true }))
    ).toBe(true)
  })

  it('allows non-WebLLM models even without WebGPU', () => {
    expect(fitsDevice(model({ engine: 'wllama' }), profile({ webGpuSupported: false }))).toBe(true)
  })

  it('rejects models exceeding 60% of known device RAM', () => {
    expect(fitsDevice(model({ estimatedRam: 4000 }), profile({ deviceMemoryMb: 4096 }))).toBe(false)
    expect(fitsDevice(model({ estimatedRam: 2000 }), profile({ deviceMemoryMb: 4096 }))).toBe(true)
  })

  it('on mobile with unknown RAM, allows only small-tagged models', () => {
    expect(fitsDevice(model({ tags: [] }), profile({ mobile: true }))).toBe(false)
    expect(fitsDevice(model({ tags: ['small'] }), profile({ mobile: true }))).toBe(true)
  })

  it('prefers the RAM budget over the mobile heuristic when RAM is known', () => {
    // A mobile device that reports RAM uses the budget, not the small-tag rule.
    expect(
      fitsDevice(model({ tags: [], estimatedRam: 1000 }), profile({ mobile: true, deviceMemoryMb: 4096 }))
    ).toBe(true)
  })
})
