// Client-side PDF → text extraction via pdf.js. Imported lazily (only when a PDF
// is actually attached) so its ~hundreds-of-KB bundle stays out of the main app.
// Text-layer PDFs only — scanned/image PDFs have no text to extract (would need
// OCR). The result is capped so a huge PDF can't blow the model's context window.

const DEFAULT_MAX_CHARS = 40_000

export async function extractPdfText(file: File, maxChars = DEFAULT_MAX_CHARS): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  // Resolve the worker that ships with the installed pdf.js version (bundled by Vite).
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString()

  const data = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data })
  const pdf = await loadingTask.promise
  try {
    const parts: string[] = []
    let total = 0
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/[ \t]+/g, ' ')
        .trim()
      parts.push(pageText)
      total += pageText.length
      if (total >= maxChars) {
        return parts.join('\n\n').slice(0, maxChars).trimEnd() + '\n\n[PDF truncated]'
      }
    }
    return parts.join('\n\n').trim()
  } finally {
    await loadingTask.destroy()
  }
}
