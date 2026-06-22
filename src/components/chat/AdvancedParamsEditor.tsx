import type { AdvancedParams } from '../../hooks/useChatHistory'
import styles from './AdvancedParamsEditor.module.css'

interface SliderProps {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  format: (v: number) => string
}

function Slider({ label, min, max, step, value, onChange, format }: SliderProps) {
  return (
    <label className={styles.slider}>
      <span className={styles.sliderLabel}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={styles.range}
        aria-label={label}
      />
      <strong className={styles.sliderValue}>{format(value)}</strong>
    </label>
  )
}

interface Props {
  value: AdvancedParams
  onChange: (v: AdvancedParams) => void
}

// Shared editor for the advanced sampling params — used in both the per-chat
// settings modal (ChatPage) and the new-chat defaults (SettingsPage).
export function AdvancedParamsEditor({ value, onChange }: Props) {
  const set = <K extends keyof AdvancedParams>(key: K, v: AdvancedParams[K]) =>
    onChange({ ...value, [key]: v })

  return (
    <div className={styles.grid}>
      <Slider
        label="Top P" min={0} max={1} step={0.01}
        value={value.topP} onChange={(v) => set('topP', v)} format={(v) => v.toFixed(2)}
      />
      <Slider
        label="Top K" min={0} max={100} step={1}
        value={value.topK} onChange={(v) => set('topK', v)} format={(v) => String(v)}
      />
      <Slider
        label="Frequency penalty" min={-2} max={2} step={0.1}
        value={value.frequencyPenalty} onChange={(v) => set('frequencyPenalty', v)} format={(v) => v.toFixed(1)}
      />
      <Slider
        label="Presence penalty" min={-2} max={2} step={0.1}
        value={value.presencePenalty} onChange={(v) => set('presencePenalty', v)} format={(v) => v.toFixed(1)}
      />

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Seed</span>
        <div className={styles.seedRow}>
          <input
            type="number"
            className={styles.seedInput}
            value={value.seed ?? ''}
            placeholder="random"
            aria-label="Seed"
            onChange={(e) => {
              const raw = e.target.value.trim()
              const n = Number(raw)
              set('seed', raw === '' || Number.isNaN(n) ? null : Math.trunc(n))
            }}
          />
          <button
            type="button"
            className={styles.seedBtn}
            title="Random seed"
            aria-label="Pick a random seed"
            onClick={() => set('seed', Math.floor(Math.random() * 2 ** 31))}
          >
            🎲
          </button>
          {value.seed !== null && (
            <button
              type="button"
              className={styles.seedBtn}
              title="Use a random seed each run"
              onClick={() => set('seed', null)}
            >
              Clear
            </button>
          )}
        </div>
        <span className={styles.hint}>Fix a seed for reproducible output; leave empty for random.</span>
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Stop sequences</span>
        <input
          type="text"
          className={styles.stopInput}
          value={value.stop.join(', ')}
          placeholder="e.g. ###, END"
          aria-label="Stop sequences"
          onChange={(e) =>
            set('stop', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))
          }
        />
        <span className={styles.hint}>Comma-separated. Generation halts when any appears.</span>
      </div>
    </div>
  )
}
