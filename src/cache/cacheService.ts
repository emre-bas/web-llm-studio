import { createLogger } from '../utils/logger'
import type { ModelEntry } from '../catalog/types'

const log = createLogger('CacheService')

// A WebLLM model's weights are stored under a per-model manifest keyed by the
// model's HF URL. hasModelInCache() keys off this manifest's presence, so we
// match it too — looking at *any* cached URL (config/wasm leftovers) produced
// false positives after a partial or failed delete. WebLLM can store this in
// three backends (chosen in Settings), so we scan all three: a model downloaded
// under one backend still shows as cached after the setting changes.
const WEIGHTS_MANIFEST_RE = /\/(?:tensor|ndarray)-cache\.json$/

function isWebllmStore(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('webllm') || lower.includes('mlc') || lower.includes('tvmjs')
}

// Backend 1: Cache API (default).
async function scanCacheApiManifests(): Promise<string[]> {
  const manifestUrls: string[] = []
  try {
    const cacheNames = await caches.keys()
    for (const name of cacheNames) {
      if (!isWebllmStore(name)) continue
      const cache = await caches.open(name)
      const keys = await cache.keys()
      for (const req of keys) {
        if (WEIGHTS_MANIFEST_RE.test(req.url)) manifestUrls.push(req.url)
      }
    }
  } catch (err) {
    log.warn('Cache API manifest scan failed:', err)
  }
  return manifestUrls
}

// Backend 2: IndexedDB. WebLLM keeps one DB per cache scope ("webllm/model"…),
// each with a "urls" object store keyed by the artifact URL.
async function scanIndexedDbManifests(): Promise<string[]> {
  const manifestUrls: string[] = []
  try {
    const idb = indexedDB as IDBFactory & {
      databases?: () => Promise<{ name?: string }[]>
    }
    if (typeof idb.databases !== 'function') return manifestUrls
    const dbs = await idb.databases()
    for (const info of dbs) {
      if (!info.name || !isWebllmStore(info.name)) continue
      try {
        const urls = await readIdbUrlKeys(info.name)
        for (const u of urls) if (WEIGHTS_MANIFEST_RE.test(u)) manifestUrls.push(u)
      } catch {
        /* skip a DB we can't read */
      }
    }
  } catch (err) {
    log.warn('IndexedDB manifest scan failed:', err)
  }
  return manifestUrls
}

function readIdbUrlKeys(dbName: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      try {
        if (!db.objectStoreNames.contains('urls')) {
          db.close()
          resolve([])
          return
        }
        const store = db.transaction('urls', 'readonly').objectStore('urls')
        const keysReq = store.getAllKeys()
        keysReq.onsuccess = () => {
          db.close()
          resolve((keysReq.result as IDBValidKey[]).map(String))
        }
        keysReq.onerror = () => {
          db.close()
          reject(keysReq.error)
        }
      } catch (e) {
        db.close()
        reject(e)
      }
    }
  })
}

// Backend 3: OPFS. WebLLM nests artifacts under "tvmjs-opfs-store", with each
// URL path segment becoming an encoded subdirectory.
const OPFS_WEBLLM_ROOT = 'tvmjs-opfs-store'

async function scanOpfsManifests(): Promise<string[]> {
  const manifestUrls: string[] = []
  try {
    const storage = navigator.storage as StorageManager & {
      getDirectory?: () => Promise<FileSystemDirectoryHandle>
    }
    if (typeof storage.getDirectory !== 'function') return manifestUrls
    const root = await storage.getDirectory()
    let store: FileSystemDirectoryHandle
    try {
      store = await root.getDirectoryHandle(OPFS_WEBLLM_ROOT)
    } catch {
      return manifestUrls // no OPFS-backed WebLLM cache
    }
    await walkOpfsForManifests(store, '', manifestUrls)
  } catch (err) {
    log.warn('OPFS manifest scan failed:', err)
  }
  return manifestUrls
}

async function walkOpfsForManifests(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: string[]
): Promise<void> {
  const d = dir as FileSystemDirectoryHandle & {
    values: () => AsyncIterable<FileSystemHandle>
  }
  for await (const handle of d.values()) {
    // Segments are encodeURIComponent'd; decode so the path mirrors the URL.
    let segment = handle.name
    try {
      segment = decodeURIComponent(handle.name)
    } catch {
      /* leave as-is if not valid encoding */
    }
    const path = `${prefix}/${segment}`
    if (handle.kind === 'directory') {
      await walkOpfsForManifests(handle as FileSystemDirectoryHandle, path, out)
    } else if (WEIGHTS_MANIFEST_RE.test(path)) {
      out.push(path)
    }
  }
}

async function scanAllWebllmManifests(): Promise<string[]> {
  const groups = await Promise.all([
    scanCacheApiManifests(),
    scanIndexedDbManifests(),
    scanOpfsManifests(),
  ])
  return groups.flat()
}

// Wllama stores GGUF files in OPFS under a "cache" directory, alongside
// "__metadata__…" JSON files that record each file's original remote URL. We
// read those to learn which GGUF URLs are downloaded — no Wllama instance (and
// thus no WASM init) required.
const WLLAMA_METADATA_PREFIX = '__metadata__'

async function scanWllamaGgufUrls(): Promise<Set<string>> {
  const urls = new Set<string>()
  try {
    const storage = navigator.storage as StorageManager & {
      getDirectory?: () => Promise<FileSystemDirectoryHandle>
    }
    if (typeof storage.getDirectory !== 'function') return urls
    const root = await storage.getDirectory()

    let cacheDir: FileSystemDirectoryHandle
    try {
      cacheDir = await root.getDirectoryHandle('cache')
    } catch {
      return urls // no Wllama cache directory yet
    }

    // values() exists on FileSystemDirectoryHandle at runtime but isn't in lib.dom yet
    const dir = cacheDir as FileSystemDirectoryHandle & {
      values: () => AsyncIterable<FileSystemHandle>
    }
    for await (const handle of dir.values()) {
      if (handle.kind !== 'file' || !handle.name.startsWith(WLLAMA_METADATA_PREFIX)) continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const meta = JSON.parse(await file.text()) as { originalURL?: string }
        if (meta.originalURL) urls.add(meta.originalURL)
      } catch {
        /* skip unreadable/partial metadata */
      }
    }
  } catch (err) {
    log.warn('Wllama OPFS scan failed:', err)
  }
  return urls
}

/**
 * Scan all storage once and return the set of catalog model IDs (`model.id`)
 * that are fully downloaded. Covers both engines: WebLLM weights (Cache API) and
 * Wllama GGUF files (OPFS). Far cheaper than per-model engine checks when marking
 * a whole catalog — each backend is enumerated a single time.
 */
export async function getCachedModelIds(models: ModelEntry[]): Promise<Set<string>> {
  const cached = new Set<string>()
  if (models.length === 0) return cached

  const [manifestUrls, ggufUrls] = await Promise.all([
    scanAllWebllmManifests(),
    scanWllamaGgufUrls(),
  ])

  for (const m of models) {
    if (m.engine === 'webllm') {
      // Match on the weights repo, not model_id: the cached manifest URL lives
      // under the HF repo path, and some models (e.g. embedding batch-size
      // variants) carry a model_id suffix like "-b4" that the repo lacks.
      // Bound by slashes so "…-MLC" doesn't match the "…-MLC-1k" variant.
      const repoName = m.repo.split('/').pop()
      if (repoName && manifestUrls.some((u) => u.includes(`/${repoName}/`))) {
        cached.add(m.id)
      }
    } else if (m.engine === 'wllama' && m.repo && m.file) {
      const url = `https://huggingface.co/${m.repo}/resolve/main/${m.file}`
      if (ggufUrls.has(url)) cached.add(m.id)
    }
  }
  return cached
}

// Substrings identifying storage owned by the model engines. Covers WebLLM
// (cache-api / indexeddb backends, OPFS root "tvmjs-opfs-store") across storage
// types. Wllama's OPFS directory is handled separately below — it is literally
// named "cache" and so matches none of these substrings.
const MODEL_STORAGE_KEYS = ['webllm', 'mlc', 'wllama', 'tvmjs']

// Wllama stores every GGUF file (and its "__metadata__…" sidecar) in a single
// top-level OPFS directory named "cache". Removing it recursively clears all
// downloaded GGUF models. See scanWllamaGgufUrls() for the read-side mirror.
const WLLAMA_OPFS_DIR = 'cache'

function isModelStorage(name: string): boolean {
  const lower = name.toLowerCase()
  return MODEL_STORAGE_KEYS.some((k) => lower.includes(k))
}

export interface ClearAllResult {
  caches: number
  databases: number
  opfsEntries: number
}

/**
 * Delete every cached model across all storage backends (Cache API, IndexedDB,
 * and OPFS). Used by the "Clear All Model Caches" action in Settings — this is
 * backend-agnostic, so it works regardless of which cache backend was used to
 * download a model and does not depend on any engine-specific deletion API.
 */
export async function clearAllModelCaches(): Promise<ClearAllResult> {
  const result: ClearAllResult = { caches: 0, databases: 0, opfsEntries: 0 }

  // 1. Cache Storage (Cache API backend)
  try {
    const cacheNames = await caches.keys()
    for (const name of cacheNames) {
      if (isModelStorage(name)) {
        await caches.delete(name)
        result.caches++
      }
    }
  } catch (err) {
    log.warn('Failed to clear Cache Storage:', err)
  }

  // 2. IndexedDB (IndexedDB backend)
  try {
    const idb = indexedDB as IDBFactory & {
      databases?: () => Promise<{ name?: string }[]>
    }
    if (typeof idb.databases === 'function') {
      const dbs = await idb.databases()
      for (const db of dbs) {
        if (db.name && isModelStorage(db.name)) {
          await new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(db.name!)
            req.onsuccess = req.onerror = req.onblocked = () => resolve()
          })
          result.databases++
        }
      }
    }
  } catch (err) {
    log.warn('Failed to clear IndexedDB:', err)
  }

  // 3. OPFS (Origin Private File System backend)
  try {
    const storage = navigator.storage as StorageManager & {
      getDirectory?: () => Promise<FileSystemDirectoryHandle>
    }
    if (typeof storage.getDirectory === 'function') {
      const root = await storage.getDirectory()
      // values() exists on FileSystemDirectoryHandle at runtime but isn't in lib.dom yet
      const dir = root as FileSystemDirectoryHandle & {
        values: () => AsyncIterable<FileSystemHandle>
      }
      const toRemove: string[] = []
      for await (const handle of dir.values()) {
        // WebLLM's OPFS root matches isModelStorage ("tvmjs-opfs-store"); Wllama's
        // is the generically-named "cache" dir, matched explicitly.
        if (isModelStorage(handle.name) || handle.name === WLLAMA_OPFS_DIR) {
          toRemove.push(handle.name)
        }
      }
      for (const name of toRemove) {
        await root.removeEntry(name, { recursive: true })
        result.opfsEntries++
      }
    }
  } catch (err) {
    log.warn('Failed to clear OPFS:', err)
  }

  log.info('Cleared all model caches:', result)
  return result
}
