import { useState } from 'react'
import { useAppStore, DEFAULT_SETTINGS, type CacheBackend, type Theme } from '../stores/appStore'
import { useChatSession } from '../hooks/useChatSession'
import { useStorage } from '../hooks/useStorage'
import { clearAllModelCaches } from '../cache/cacheService'
import { engineManager } from '../engines/engineManager'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { AdvancedParamsEditor } from '../components/chat/AdvancedParamsEditor'
import { formatBytes } from '../utils/formatBytes'
import styles from './SettingsPage.module.css'

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {description && <p className={styles.sectionDesc}>{description}</p>}
      </div>
      <Card>{children}</Card>
    </section>
  )
}

function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowLeft}>
        <div className={styles.rowLabel}>{label}</div>
        {description && <div className={styles.rowDesc}>{description}</div>}
      </div>
      <div className={styles.rowRight}>{children}</div>
    </div>
  )
}

const CACHE_BACKENDS: { value: CacheBackend; label: string; desc: string }[] = [
  { value: 'cache-api', label: 'Cache API', desc: 'Default browser cache. Fastest. May be evicted.' },
  { value: 'indexeddb', label: 'IndexedDB', desc: 'Structured storage. More persistent than Cache API.' },
  { value: 'opfs', label: 'OPFS', desc: 'Origin Private File System. Most persistent. Chrome/Edge, Firefox 111+, Safari 16.4+.' },
]

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function SettingsPage() {
  const { settings, updateSettings, addToast } = useAppStore()
  const {
    defaultSystemPrompt,
    setDefaultSystemPrompt,
    defaultTemperature,
    setDefaultTemperature,
    defaultMaxTokens,
    setDefaultMaxTokens,
    defaultAdvancedParams,
    setDefaultAdvancedParams,
    resetChatSettings,
  } = useChatSession()
  const { info: storage, loading: storageLoading, requesting, requestPersist, refresh } = useStorage()
  const [clearing, setClearing] = useState(false)

  // Theme and dev-logs side effects are applied globally in App.tsx from the
  // same store, so they take effect here without any local effect.

  const handleReset = () => {
    if (!confirm('Reset all settings to defaults? This also resets your new-chat defaults (system prompt, temperature, max tokens). Conversations you have already started keep their own settings.')) return
    updateSettings(DEFAULT_SETTINGS)
    resetChatSettings()
    addToast('success', 'Settings reset to defaults')
  }

  const handleRequestPersist = async () => {
    const granted = await requestPersist()
    if (granted) {
      addToast('success', 'Persistent storage granted')
    } else {
      // persist() resolves false without a prompt when the browser declines
      // based on its own heuristics (site engagement, bookmarks, etc.).
      addToast(
        'warning',
        'The browser declined persistent storage. Interacting with the app more, ' +
        'or bookmarking/installing it, can make it grant this later.'
      )
    }
  }

  const handleClearAllCaches = async () => {
    if (!confirm('Delete all cached model files? Downloaded models will need to be fetched again.')) return
    setClearing(true)
    try {
      // Unload any active model so its files aren't held open during deletion.
      await engineManager.unload()
      const result = await clearAllModelCaches()
      const total = result.caches + result.databases + result.opfsEntries
      addToast(
        'success',
        total > 0 ? 'All model caches cleared.' : 'No cached models found.'
      )
      await refresh()
    } catch (err) {
      addToast('error', 'Failed to clear caches: ' + String(err))
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>App preferences and engine configuration</p>
      </div>

      <div className={styles.sections}>

        {/* Theme */}
        <Section title="Appearance" description="Theme and display preferences">
          <Row label="Theme" description="Controls the app color scheme">
            <div className={styles.chipGroup}>
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  className={`${styles.chip} ${settings.theme === t.value ? styles.chipActive : ''}`}
                  onClick={() => updateSettings({ theme: t.value })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Row>
        </Section>

        {/* Voice */}
        <Section title="Voice" description="Speech input and output. Output uses your device's built-in voices; input uses the browser's speech service.">
          <Row
            label="Auto-read replies aloud"
            description="Automatically speak each new assistant reply using local text-to-speech (speechSynthesis). No audio leaves your device for output."
          >
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={settings.autoSpeak}
                onChange={(e) => updateSettings({ autoSpeak: e.target.checked })}
              />
              <span className={styles.toggleTrack} />
            </label>
          </Row>
        </Section>

        {/* New Chat Defaults */}
        <Section
          title="New Chat Defaults"
          description="What every new conversation starts with. Each chat then keeps its own settings (editable from the gear button inside the chat) — changing these defaults won't touch chats you've already started."
        >
          <div className={styles.chatDefaults}>
            <label className={styles.fieldLabel}>Default System Prompt</label>
            <textarea
              className={styles.promptInput}
              value={defaultSystemPrompt}
              onChange={(e) => setDefaultSystemPrompt(e.target.value)}
              rows={4}
              placeholder="Set the assistant's behavior and persona…"
            />
            <div className={styles.sliderRow}>
              <div className={styles.sliderItem}>
                <span>Temperature</span>
                <input
                  type="range"
                  min={0} max={2} step={0.1}
                  value={defaultTemperature}
                  onChange={(e) => setDefaultTemperature(Number(e.target.value))}
                  className={styles.range}
                  aria-label="Default temperature"
                />
                <strong>{defaultTemperature.toFixed(1)}</strong>
              </div>
              <div className={styles.sliderItem}>
                <span>Max tokens</span>
                <input
                  type="range"
                  min={64} max={4096} step={64}
                  value={defaultMaxTokens}
                  onChange={(e) => setDefaultMaxTokens(Number(e.target.value))}
                  className={styles.range}
                  aria-label="Default max tokens"
                />
                <strong>{defaultMaxTokens}</strong>
              </div>
            </div>
            <details className={styles.advancedDefaults}>
              <summary className={styles.advancedDefaultsSummary}>Advanced parameters</summary>
              <AdvancedParamsEditor value={defaultAdvancedParams} onChange={setDefaultAdvancedParams} />
            </details>
          </div>
        </Section>

        {/* WebLLM Cache */}
        <Section
          title="WebLLM Cache Backend"
          description="Where WebLLM stores downloaded model weights. All options use browser storage."
        >
          <div className={styles.cacheOptions}>
            {CACHE_BACKENDS.map((b) => (
              <label
                key={b.value}
                className={`${styles.cacheOption} ${settings.cacheBackend === b.value ? styles.cacheActive : ''}`}
              >
                <input
                  type="radio"
                  name="cacheBackend"
                  value={b.value}
                  checked={settings.cacheBackend === b.value}
                  onChange={() => updateSettings({ cacheBackend: b.value })}
                  className={styles.radioHidden}
                />
                <div className={styles.cacheOptionInner}>
                  <div className={styles.cacheOptionLabel}>
                    {b.label}
                    {settings.cacheBackend === b.value && <Badge variant="accent" size="sm">Active</Badge>}
                  </div>
                  <div className={styles.cacheOptionDesc}>{b.desc}</div>
                </div>
              </label>
            ))}
          </div>
          <p className={styles.note}>
            Changing the backend only affects models downloaded from now on. Models already
            cached under the previous backend stay on disk and are re-downloaded on next load —
            use “Clear All Model Caches” below to remove them.
          </p>
        </Section>

        {/* Inference Engine */}
        <Section title="Inference Engine" description="GPU and acceleration settings">
          <Row
            label="GGUF Acceleration (Wllama)"
            description="GGUF models run on the CPU via WebAssembly. GPU offloading (n_gpu_layers) isn't available in the browser build of llama.cpp, so these models are always CPU-only. WebGPU acceleration applies to WebLLM models instead."
          >
            <Badge variant="muted">CPU only</Badge>
          </Row>
        </Section>

        {/* Storage */}
        <Section title="Browser Storage" description="Persistent storage affects whether cached models survive browser restarts.">
          {storageLoading ? (
            <p className={styles.muted}>Loading storage info…</p>
          ) : storage ? (
            <div className={styles.storageInfo}>
              <Row label="Storage Used" description={undefined}>
                <span className={styles.storageValue}>{formatBytes(storage.usage)} / {formatBytes(storage.quota)}</span>
              </Row>
              <div className={styles.divider} />
              <Row
                label="Persistent Storage"
                description="Prevents the browser from evicting cached model files when disk space is low."
              >
                <div className={styles.persistRow}>
                  <Badge variant={storage.persistent ? 'success' : 'warning'}>
                    {storage.persistent ? 'Granted' : 'Not granted'}
                  </Badge>
                  {!storage.persistent && (
                    <Button size="sm" variant="primary" loading={requesting} onClick={handleRequestPersist}>
                      Request
                    </Button>
                  )}
                </div>
              </Row>
              <div className={styles.divider} />
              <Row
                label="Clear All Model Caches"
                description="Deletes every downloaded model from browser storage (Cache API, IndexedDB, and OPFS). Models will be re-downloaded on next load."
              >
                <Button size="sm" variant="danger" loading={clearing} onClick={handleClearAllCaches}>
                  Clear All
                </Button>
              </Row>
              <div className={styles.divider} />
              <Button size="sm" variant="ghost" onClick={refresh}>Refresh Storage Info</Button>
            </div>
          ) : (
            <p className={styles.muted}>Storage API not available.</p>
          )}
        </Section>

        {/* Developer */}
        <Section title="Developer" description="Debug and logging options">
          <Row
            label="Developer Logs"
            description="Enables verbose console logging from the engine adapters and catalog loader."
          >
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={settings.devLogs}
                onChange={(e) => updateSettings({ devLogs: e.target.checked })}
              />
              <span className={styles.toggleTrack} />
            </label>
          </Row>
        </Section>

        {/* Reset */}
        <Section title="Reset" description="Restore all settings to their default values.">
          <Row
            label="Reset All Settings"
            description="Resets appearance, storage, and your new-chat defaults (system prompt, temperature, max tokens). Doesn't change conversations you've already started, or delete cached models."
          >
            <Button variant="danger" size="sm" onClick={handleReset}>
              Reset to Defaults
            </Button>
          </Row>
        </Section>

      </div>
    </div>
  )
}
