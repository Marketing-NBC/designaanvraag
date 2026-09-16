import type { SVGProps } from 'react'

export type IconName =
  | 'arrow-right'
  | 'arrow-left'
  | 'chevron-up'
  | 'chevron-down'
  | 'check'
  | 'alert'
  | 'sparkle'
  | 'external'
  | 'paperclip'
  | 'close'

const PATHS: Record<IconName, React.ReactNode> = {
  'arrow-right': <path d="M5 12h14m0 0-5-5m5 5-5 5" />,
  'arrow-left': <path d="M19 12H5m0 0 5 5m-5-5 5-5" />,
  'chevron-up': <path d="m6 15 6-6 6 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  check: <path d="M5 12.5 10 17 19 7" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5m0 3v.5" />
    </>
  ),
  sparkle: <path d="M12 3v4m0 10v4M3 12h4m10 0h4m-2.5-6.5-2.8 2.8M8.3 15.7l-2.8 2.8m0-13 2.8 2.8m7.4 7.4 2.8 2.8" />,
  external: <path d="M14 5h5v5m0-5-9 9M19 14v5H5V5h5" />,
  paperclip: <path d="M17 8.5V16a5 5 0 0 1-10 0V7a3.5 3.5 0 0 1 7 0v8.5a2 2 0 0 1-4 0V8" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
}

/** Heroicons-achtige lijniconen (NBC-DS: geen emoji, geen icon-font). */
export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}
