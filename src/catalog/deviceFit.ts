import type { ModelEntry } from './types'
import type { DeviceProfile } from '../hooks/useDeviceProfile'

/**
 * Returns false only when there is positive evidence the model won't work on
 * this device. When signals are absent (Firefox, unknown RAM) we stay permissive
 * rather than hiding potentially valid options.
 */
export function fitsDevice(model: ModelEntry, profile: DeviceProfile): boolean {
  // WebLLM needs WebGPU. Skip the check while detection is still in flight.
  if (model.engine === 'webllm' && !profile.webGpuChecking && !profile.webGpuSupported) {
    return false
  }

  if (profile.deviceMemoryMb !== undefined) {
    // Leave ~40% headroom for OS + browser tabs.
    if (model.estimatedRam > profile.deviceMemoryMb * 0.6) return false
  } else if (profile.mobile) {
    // No RAM figure on mobile → allow only explicitly small models.
    if (!model.tags.includes('small')) return false
  }

  return true
}
