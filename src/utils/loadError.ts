// Turn a raw engine/model load error into a friendly title + actionable hint.
// The matched substrings are intentionally broad — the goal is a helpful next
// step; the raw message is still shown beneath for anyone who wants the detail.
export function classifyLoadError(msg: string): { title: string; hint: string } {
  const m = msg.toLowerCase()
  if (/webgpu|adapter|gpu device|no available backend|device.*lost|createshader/.test(m)) {
    return {
      title: 'Your browser couldn’t start this model on the GPU',
      hint: 'WebGPU-powered models need Chrome or Edge with hardware acceleration enabled. Check your browser, or try a smaller model.',
    }
  }
  if (/network|fetch|failed to load|connection|cors|timeout|err_/.test(m)) {
    return {
      title: 'The download was interrupted',
      hint: 'Check your connection and try again — chunks already downloaded are cached, so a retry resumes where it left off.',
    }
  }
  if (/quota|storage|disk|space|exceeded|no space/.test(m)) {
    return {
      title: 'Not enough storage to cache this model',
      hint: 'Free up disk space, or remove a previously downloaded model from the Models page, then retry. A smaller model needs less room.',
    }
  }
  return { title: 'The model couldn’t be loaded', hint: 'Something went wrong while loading. Try again, or pick a different model.' }
}
