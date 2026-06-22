import { describe, it, expect } from 'vitest'
import { formatBytes, formatMB } from './formatBytes'

describe('formatBytes', () => {
  it('returns "0 B" for zero', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats bytes, KB, MB, GB with one decimal by default', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1048576)).toBe('1 MB')
    expect(formatBytes(1610612736)).toBe('1.5 GB')
  })

  it('respects the decimals argument', () => {
    expect(formatBytes(1536, 0)).toBe('2 KB')
    expect(formatBytes(1503238553, 2)).toBe('1.4 GB')
  })
})

describe('formatMB', () => {
  it('keeps values under 1 GB in MB', () => {
    expect(formatMB(512)).toBe('512 MB')
    expect(formatMB(1023)).toBe('1023 MB')
  })

  it('converts >= 1024 MB to GB with one decimal', () => {
    expect(formatMB(1024)).toBe('1.0 GB')
    expect(formatMB(1536)).toBe('1.5 GB')
    expect(formatMB(6144)).toBe('6.0 GB')
  })
})
