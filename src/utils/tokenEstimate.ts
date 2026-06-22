import type { ChatEntry } from '../hooks/useChat'

// Rough token estimate without shipping a tokenizer: most BPE tokenizers average
// ~4 characters per token for English-ish text. This is intentionally
// approximate — it powers a "context usage" gauge, not billing — so the UI
// always labels it as an estimate (~).
const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

// Estimate the tokens a conversation will occupy: the system prompt plus every
// message, with a small per-message overhead for the chat-template role markers.
const PER_MESSAGE_OVERHEAD = 4

export function estimateConversationTokens(
  messages: Pick<ChatEntry, 'content'>[],
  systemPrompt = ''
): number {
  let total = estimateTokens(systemPrompt)
  for (const m of messages) {
    total += estimateTokens(m.content) + PER_MESSAGE_OVERHEAD
  }
  return total
}
