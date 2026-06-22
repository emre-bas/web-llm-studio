import { useState, useEffect, useCallback } from 'react'
import { getStorageInfo, requestPersistentStorage, type StorageInfo } from '../cache/storageEstimate'

export function useStorage() {
  const [info, setInfo] = useState<StorageInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getStorageInfo()
      setInfo(data)
    } finally {
      setLoading(false)
    }
  }, [])

  const requestPersist = useCallback(async () => {
    setRequesting(true)
    try {
      const granted = await requestPersistentStorage()
      // Always refresh: the browser may flip the persisted state without
      // returning true here (e.g. after a prompt in Firefox), and callers
      // rely on the refreshed badge to reflect reality.
      await refresh()
      return granted
    } finally {
      setRequesting(false)
    }
  }, [refresh])

  useEffect(() => { refresh() }, [refresh])

  return { info, loading, requesting, refresh, requestPersist }
}
