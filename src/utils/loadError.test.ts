import { describe, it, expect } from 'vitest'
import { classifyLoadError } from './loadError'

describe('classifyLoadError', () => {
  it('maps WebGPU/adapter failures to the GPU hint', () => {
    for (const msg of ['WebGPU is not available', 'requestAdapter returned null', 'GPU device was lost', 'createShaderModule failed']) {
      expect(classifyLoadError(msg).title).toMatch(/GPU/i)
    }
  })

  it('maps network/fetch failures to the download-interrupted hint', () => {
    for (const msg of ['Failed to fetch', 'network error', 'Connection reset', 'ERR_TIMED_OUT']) {
      expect(classifyLoadError(msg).title).toMatch(/download was interrupted/i)
    }
  })

  it('maps storage/quota failures to the storage hint', () => {
    for (const msg of ['QuotaExceededError', 'no space left on disk', 'storage limit exceeded']) {
      expect(classifyLoadError(msg).title).toMatch(/storage/i)
    }
  })

  it('falls back to a generic message for unrecognised errors', () => {
    const out = classifyLoadError('something totally unexpected')
    expect(out.title).toMatch(/couldn’t be loaded/i)
    expect(out.hint).toBeTruthy()
  })

  it('is case-insensitive', () => {
    expect(classifyLoadError('WEBGPU ADAPTER MISSING').title).toMatch(/GPU/i)
  })
})
