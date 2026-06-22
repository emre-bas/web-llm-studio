import { describe, it, expect } from 'vitest'
import { estimateTokens, estimateConversationTokens } from './tokenEstimate'

describe('estimateTokens', () => {
  it('returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('uses ~4 chars per token, rounding up', () => {
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2) // 5 / 4 → ceil → 2
    expect(estimateTokens('a'.repeat(40))).toBe(10)
  })
})

describe('estimateConversationTokens', () => {
  it('counts the system prompt plus per-message overhead', () => {
    // system "abcd" = 1 token; one message "abcd" = 1 token + 4 overhead.
    expect(
      estimateConversationTokens([{ content: 'abcd' }], 'abcd')
    ).toBe(1 + 1 + 4)
  })

  it('sums across messages', () => {
    const msgs = [{ content: 'abcd' }, { content: 'abcd' }]
    // 0 system + (1+4) + (1+4) = 10
    expect(estimateConversationTokens(msgs)).toBe(10)
  })

  it('handles an empty conversation', () => {
    expect(estimateConversationTokens([])).toBe(0)
  })
})
