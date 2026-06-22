import { useNavigate } from 'react-router-dom'
import { useWebGpu } from '../hooks/useWebGpu'
import { useStorage } from '../hooks/useStorage'
import { useEngine } from '../hooks/useEngine'
import { useAppStore } from '../stores/appStore'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Progress } from '../components/ui/Progress'
import { Spinner } from '../components/ui/Spinner'
import { formatBytes } from '../utils/formatBytes'
import styles from './DashboardPage.module.css'

function InfoRow({ label, description, value, valueTitle }: { label: string; description?: string; value: React.ReactNode; valueTitle?: string }) {
  return (
    <div className={styles.infoRow}>
      <div className={styles.infoLeft}>
        <span className={styles.infoLabel}>{label}</span>
        {description && <span className={styles.infoDesc}>{description}</span>}
      </div>
      <span className={styles.infoValue} title={valueTitle}>{value}</span>
    </div>
  )
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {subtitle && <p className={styles.sectionSubtitle}>{subtitle}</p>}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  )
}

export function DashboardPage() {
  const navigate = useNavigate()
  const gpu = useWebGpu()
  const { info: storage, loading: storageLoading, requesting, requestPersist, refresh } =
    useStorage()
  const { loadedModel, status, loadProgress, loadProgressText } = useEngine()
  const { settings, addToast } = useAppStore()

  const isChrome = navigator.userAgent.includes('Chrome')
  const isFirefox = navigator.userAgent.includes('Firefox')

  const handleRequestPersist = async () => {
    const granted = await requestPersist()
    addToast(
      granted ? 'success' : 'warning',
      granted
        ? 'Persistent storage granted'
        : 'The browser declined persistent storage. Interacting with the app more, ' +
          'or bookmarking/installing it, can make it grant this later.'
    )
  }

  return (
    <div className={styles.page}>
      {/* Page header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>System Status</h1>
          <p className={styles.subtitle}>Browser capabilities, engine state, and storage</p>
        </div>
        <Button variant="primary" onClick={() => navigate('/')}>
          ← Back to Chat
        </Button>
      </div>

      {/* WebGPU warning */}
      {!gpu.checking && !gpu.supported && (
        <div className={styles.alert} role="alert">
          <span className={styles.alertIcon} aria-hidden="true">⚠️</span>
          <div>
            <strong>GPU acceleration unavailable</strong>
            <p>
              WebGPU is required for fast WebLLM inference. Use Chrome 113+ or Edge 113+.
              GGUF models can still run via CPU (Wllama).
            </p>
            {gpu.error && <code className={styles.alertCode}>{gpu.error}</code>}
          </div>
        </div>
      )}

      <div className={styles.grid}>
        {/* GPU Acceleration */}
        <SectionCard
          title="GPU Acceleration"
          subtitle="Your browser can use the GPU for faster local model inference."
        >
          <div className={styles.statusRow}>
            {gpu.checking ? (
              <><Spinner size="sm" /><span className={styles.statusText}>Checking…</span></>
            ) : gpu.supported ? (
              <><div className={`${styles.dot} ${styles.dotGreen}`} /><span className={styles.statusText}>WebGPU available</span></>
            ) : (
              <><div className={`${styles.dot} ${styles.dotRed}`} /><span className={styles.statusText}>WebGPU unavailable</span></>
            )}
            <Badge variant={gpu.supported ? 'success' : 'danger'}>
              {gpu.supported ? 'Supported' : 'Not supported'}
            </Badge>
          </div>
          <div className={styles.infoList}>
            <InfoRow label="GPU Adapter" value={gpu.adapterName ?? (gpu.checking ? '—' : 'Not found')} valueTitle={gpu.adapterName} />
            <InfoRow
              label="Browser"
              value={isChrome ? 'Chrome (recommended)' : isFirefox ? 'Firefox (limited WebGPU)' : 'Other'}
            />
            <InfoRow label="Platform" value={navigator.platform} />
          </div>
          {!gpu.supported && !gpu.checking && (
            <p className={styles.hint}>Install Chrome 113+ or Edge 113+ for WebGPU support.</p>
          )}
        </SectionCard>

        {/* Current Model */}
        <SectionCard
          title="Current Model"
          subtitle="The model currently loaded in the browser inference engine."
        >
          <div className={styles.statusRow}>
            <div className={`${styles.dot} ${styles['dot-' + status]}`} />
            <span className={styles.statusText}>
              {status === 'idle'
                ? 'No model loaded'
                : status === 'loading'
                ? 'Loading model…'
                : status === 'ready'
                ? 'Ready to chat'
                : status === 'generating'
                ? 'Generating response…'
                : status === 'error'
                ? 'Engine error'
                : 'Unloading…'}
            </span>
          </div>
          {status === 'loading' && (
            <div className={styles.progressBox}>
              <Progress value={loadProgress} showPercent size="sm" />
              {loadProgressText && (
                <p className={styles.progressText}>{loadProgressText}</p>
              )}
            </div>
          )}
          <div className={styles.infoList}>
            <InfoRow label="Model" value={loadedModel?.name ?? <span className={styles.none}>None</span>} />
            <InfoRow label="Engine" value={loadedModel?.engine?.toUpperCase() ?? <span className={styles.none}>—</span>} />
            <InfoRow label="Format" value={loadedModel?.format?.toUpperCase() ?? <span className={styles.none}>—</span>} />
            <InfoRow label="Cache backend" value={settings.cacheBackend} />
          </div>
          <div className={styles.cardActions}>
            {loadedModel ? (
              <Button size="sm" variant="primary" onClick={() => navigate('/')}>Go to Chat</Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => navigate('/models')}>Load a Model</Button>
            )}
          </div>
        </SectionCard>

        {/* Storage & Cache */}
        <SectionCard
          title="Storage & Cache"
          subtitle="Models are cached in your browser after the first download."
        >
          {storageLoading ? (
            <div className={styles.loadingRow}><Spinner size="sm" /><span>Checking storage…</span></div>
          ) : storage ? (
            <>
              <div className={styles.statusRow}>
                <div className={`${styles.dot} ${storage.persistent ? styles.dotGreen : styles.dotYellow}`} />
                <span className={styles.statusText}>
                  {storage.persistent
                    ? 'Persistent — browser won\'t evict cached models'
                    : 'Standard — browser may evict cached models when low on space'}
                </span>
                <Badge variant={storage.persistent ? 'success' : 'warning'}>
                  {storage.persistent ? 'Persistent' : 'Temporary'}
                </Badge>
              </div>
              <div className={styles.progressBox}>
                <Progress
                  value={storage.usagePercent * 100}
                  label={`${formatBytes(storage.usage)} used of ${formatBytes(storage.quota)}`}
                  showPercent
                  size="sm"
                  variant={storage.usagePercent > 0.8 ? 'danger' : storage.usagePercent > 0.6 ? 'warning' : 'accent'}
                />
              </div>
              <div className={styles.infoList}>
                <InfoRow label="Used" value={formatBytes(storage.usage)} />
                <InfoRow label="Quota" value={formatBytes(storage.quota)} />
              </div>
              {!storage.persistent && (
                <p className={styles.hint}>
                  Request persistent storage to reduce the chance that downloaded model files are removed by the browser.
                </p>
              )}
              <div className={styles.cardActions}>
                <Button size="sm" variant="ghost" onClick={refresh}>Refresh</Button>
                {!storage.persistent && (
                  <Button size="sm" variant="primary" loading={requesting} onClick={handleRequestPersist}>
                    Request Persistent Storage
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className={styles.hint}>Storage API not available in this browser.</p>
          )}
        </SectionCard>

        {/* Runtime Settings */}
        <SectionCard title="Runtime Settings" subtitle="Current app configuration.">
          <div className={styles.infoList}>
            <InfoRow label="Theme" value={settings.theme} />
            <InfoRow label="Cache backend" value={settings.cacheBackend} />
            <InfoRow label="GGUF acceleration" value="CPU only" />
            <InfoRow label="Developer logs" value={settings.devLogs ? 'On' : 'Off'} />
          </div>
          <div className={styles.cardActions}>
            <Button size="sm" onClick={() => navigate('/settings')}>Edit Settings</Button>
          </div>
        </SectionCard>

        {/* Local Inference Notes */}
        <SectionCard
          title="Local Inference Notes"
          subtitle="How browser-based AI inference works."
        >
          <ul className={styles.notesList}>
            {[
              'Model weights download once and cache in your browser. Subsequent loads are fast.',
              'WebLLM uses WebGPU for GPU-accelerated inference. Chrome 113+ recommended.',
              'GGUF models run on CPU via Wllama — significantly slower than WebGPU.',
              'Models over 3 GB may fail or be very slow due to browser memory limits.',
              'No data leaves your browser. Prompts and responses are processed locally.',
              'Cache can be managed from the Models page or cleared via browser DevTools.',
            ].map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </SectionCard>

        {/* Model Size Guide */}
        <SectionCard
          title="Model Size Guide"
          subtitle="Approximate VRAM/RAM requirements by model size."
        >
          <div className={styles.sizeGuide}>
            {[
              { label: '360M – 500M', note: 'Tiny models', ram: '~400–600 MB', dot: styles.dotGreen, good: 'Great for quick testing' },
              { label: '1B – 2B', note: 'Small models', ram: '~1–1.5 GB', dot: styles.dotGreen, good: 'Good balance of speed and quality' },
              { label: '3B – 4B', note: 'Mid-size models', ram: '~2–3 GB', dot: styles.dotYellow, good: 'Require a capable GPU' },
              { label: '7B+', note: 'Large models', ram: '~4–6 GB', dot: styles.dotRed, good: 'May exceed browser limits' },
            ].map((row) => (
              <div key={row.label} className={styles.sizeRow}>
                <div className={`${styles.dot} ${row.dot}`} style={{ flexShrink: 0, marginTop: 4 }} />
                <div>
                  <div className={styles.sizeLabel}>{row.label} <span className={styles.sizeNote}>{row.note}</span></div>
                  <div className={styles.sizeMeta}>{row.ram} · {row.good}</div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
