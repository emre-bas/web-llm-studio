import { useState, useEffect } from 'react'

export interface WebGpuInfo {
  supported: boolean
  checking: boolean
  adapterName?: string
  error?: string
}

// Extend Navigator with WebGPU - not all TypeScript DOM lib versions include this
type NavigatorWithGpu = Navigator & {
  gpu?: {
    requestAdapter(): Promise<GPUAdapter | null>
  }
}

// Adapter info fields (GPUAdapterInfo). vendor/architecture are the reliably
// populated ones in current browsers; device/description are often empty for privacy.
interface AdapterInfo {
  vendor?: string
  architecture?: string
  device?: string
  description?: string
}

// GPUAdapter might not be typed in all TS versions. Modern browsers expose
// `info` synchronously; older ones used the now-removed requestAdapterInfo().
interface GPUAdapter {
  info?: AdapterInfo
  requestAdapterInfo?(): Promise<AdapterInfo>
}

// ── Name resolution ────────────────────────────────────────────────────────
// WebGPU gives a reliable but coarse identity (e.g. "nvidia ampere"). WebGL's
// unmasked renderer gives a recognizable model name (e.g. "NVIDIA GeForce
// RTX 3070") but is messier and sometimes blocked. We try to combine them:
// a clean WebGL model name wins, otherwise we fall back to the WebGPU identity.
// Every step is defensive — any failure just yields a coarser name, never an error.

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

// Build a name from GPUAdapterInfo. Returns undefined when nothing usable is present.
function webgpuName(info?: AdapterInfo): string | undefined {
  if (!info) return undefined
  if (info.description && info.description.trim()) return info.description.trim()
  const parts = [info.vendor, info.architecture].map((p) => p?.trim()).filter(Boolean)
  if (parts.length) return titleCase(parts.join(' '))
  return info.device?.trim() || undefined
}

// Strip ANGLE wrappers, API/driver suffixes, and device-id noise from a raw
// WebGL renderer string to leave just the human-readable GPU model.
function cleanRenderer(raw: string): string {
  let r = raw.trim()

  // Unwrap "ANGLE (vendor, device api, backend)" → take the device segment.
  const angle = r.match(/^ANGLE \((.*)\)$/)
  if (angle) {
    const segs = angle[1].split(',').map((s) => s.trim())
    r = segs.length >= 2 ? segs[1] : angle[1]
  }

  r = r
    .replace(/^ANGLE Metal Renderer:\s*/i, '') // macOS Metal-ANGLE prefix
    .replace(/\s*\(0x[0-9A-Fa-f]+\)/g, '')     // PCI device ids
    .replace(/\s+Direct3D.*$/i, '')
    .replace(/\s+D3D\d+.*$/i, '')
    .replace(/\s+OpenGL.*$/i, '')
    .replace(/\s+Metal.*$/i, '')
    .replace(/\s+Vulkan.*$/i, '')
    .replace(/\s+vs_\d.*$/i, '')
    .replace(/\/(PCIe|SSE2|PCI).*$/i, '')
    .trim()

  return r
}

// Read the WebGL unmasked renderer. Fully guarded — returns undefined on any
// failure (no WebGL, blocked extension, software fallback context, etc.).
function readWebglRenderer(): string | undefined {
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) return undefined

    const dbg = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null
    const raw = dbg
      ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER)

    // Release the context promptly; ignore if the extension is unavailable.
    ;(gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext()

    if (typeof raw !== 'string' || !raw.trim()) return undefined
    return cleanRenderer(raw)
  } catch {
    return undefined
  }
}

// Software renderers tell the user nothing useful about their hardware — prefer
// the WebGPU identity over these when one is available.
function isSoftwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|software|microsoft basic|google.*renderer$/i.test(name)
}

// Combine both sources into the best display name we can produce.
function resolveAdapterName(info: AdapterInfo | undefined, webglRenderer: string | undefined): string {
  const gpuName = webgpuName(info)

  if (webglRenderer) {
    // A descriptive hardware name from WebGL wins — unless it's a software
    // renderer and we have a real WebGPU identity to show instead.
    if (!isSoftwareRenderer(webglRenderer) || !gpuName) return webglRenderer
  }
  return gpuName ?? webglRenderer ?? 'Unknown GPU'
}

export function useWebGpu(): WebGpuInfo {
  const [info, setInfo] = useState<WebGpuInfo>({ supported: false, checking: true })

  useEffect(() => {
    let cancelled = false

    async function check() {
      const nav = navigator as NavigatorWithGpu

      if (!nav.gpu) {
        if (!cancelled) setInfo({ supported: false, checking: false, error: 'WebGPU API not available in this browser' })
        return
      }
      try {
        const adapter = await nav.gpu.requestAdapter()
        if (!adapter) {
          if (!cancelled) setInfo({ supported: false, checking: false, error: 'No WebGPU adapter found' })
          return
        }
        // Modern browsers expose adapter.info synchronously; fall back to the
        // legacy async requestAdapterInfo() for older engines.
        const adapterInfo = adapter.info ?? (await adapter.requestAdapterInfo?.())
        const webglRenderer = readWebglRenderer()
        if (!cancelled) {
          setInfo({
            supported: true,
            checking: false,
            adapterName: resolveAdapterName(adapterInfo, webglRenderer),
          })
        }
      } catch (err) {
        if (!cancelled) {
          setInfo({ supported: false, checking: false, error: String(err) })
        }
      }
    }

    check()
    return () => { cancelled = true }
  }, [])

  return info
}
