// Shared line icons for primary navigation (sidebar + mobile bottom nav).
// Monochrome, currentColor stroke — matches the hexagon brand mark.

type IconProps = { size?: number }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

export function ChatIcon({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
    </svg>
  )
}

export function ModelsIcon({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3 21 8l-9 5-9-5 9-5Z" />
      <path d="M3 12l9 5 9-5" />
      <path d="M3 16l9 5 9-5" />
    </svg>
  )
}

export function StatusIcon({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 13h3l2 5 4-12 2 7h3" />
    </svg>
  )
}

export function SettingsIcon({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 7h10M18 7h2" />
      <circle cx="16" cy="7" r="2" />
      <path d="M4 17h2M10 17h10" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  )
}
