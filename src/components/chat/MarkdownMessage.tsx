import { memo, useState, useCallback, isValidElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import styles from './MarkdownMessage.module.css'

// Pull the raw text out of a React node tree so a code block's copy button has
// the literal source, not rendered markup.
function nodeToText(node: ReactNode): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeToText).join('')
  if (isValidElement(node)) {
    return nodeToText((node.props as { children?: ReactNode }).children)
  }
  return ''
}

function CodeCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])
  return (
    <button className={styles.codeCopy} onClick={copy} type="button" aria-label="Copy code">
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// Fenced code blocks arrive as <pre><code>…</code></pre>; wrap them so each gets
// its own copy button. Inline `code` is left to the `code` renderer + CSS.
function Pre({ children }: { children?: ReactNode }) {
  return (
    <div className={styles.codeBlock}>
      <CodeCopyButton text={nodeToText(children)} />
      <pre>{children}</pre>
    </div>
  )
}

function Anchor({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

export const MarkdownMessage = memo(function MarkdownMessage({
  content,
  streaming = false,
}: {
  content: string
  streaming?: boolean
}) {
  // While streaming, a blinking caret is appended (via CSS ::after) to the last
  // rendered block, so it reads like live typing instead of a bar below the text.
  return (
    <div className={`${styles.markdown} ${streaming ? styles.streaming : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{ pre: Pre, a: Anchor }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
