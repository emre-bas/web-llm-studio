export interface StorageInfo {
  usage: number
  quota: number
  usagePercent: number
  persistent: boolean
}

export async function getStorageInfo(): Promise<StorageInfo> {
  const estimate = await navigator.storage?.estimate()
  const persistent = await navigator.storage?.persisted()

  return {
    usage: estimate?.usage ?? 0,
    quota: estimate?.quota ?? 0,
    usagePercent:
      estimate?.quota && estimate.quota > 0
        ? (estimate.usage ?? 0) / estimate.quota
        : 0,
    persistent: persistent ?? false,
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return await navigator.storage?.persist() ?? false
  } catch {
    return false
  }
}
