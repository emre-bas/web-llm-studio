import { useWebGpu } from './useWebGpu'

export interface DeviceProfile {
  /** Approximate device RAM in MB. undefined on Firefox/Safari (no API). */
  deviceMemoryMb?: number
  /** WebGPU adapter found — required for WebLLM models. */
  webGpuSupported: boolean
  /** True while WebGPU check is still in flight; don't filter on this signal yet. */
  webGpuChecking: boolean
  mobile: boolean
}

type NavigatorWithExtras = Navigator & {
  deviceMemory?: number
  userAgentData?: { mobile: boolean }
}

function detectMobile(): boolean {
  const nav = navigator as NavigatorWithExtras
  if (nav.userAgentData?.mobile !== undefined) return nav.userAgentData.mobile
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

export function useDeviceProfile(): DeviceProfile {
  const gpu = useWebGpu()
  const nav = navigator as NavigatorWithExtras
  return {
    deviceMemoryMb: nav.deviceMemory ? nav.deviceMemory * 1024 : undefined,
    webGpuSupported: gpu.supported,
    webGpuChecking: gpu.checking,
    mobile: detectMobile(),
  }
}
