import type { ReactNode } from 'react'
import type { IconName } from '../nav'

export function Mark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" className="fill-teal" />
      <rect x="7" y="7" width="7" height="7" rx="1.2" fill="#f4fffc" />
      <rect x="18" y="7" width="7" height="7" rx="1.2" fill="#f4fffc" opacity="0.45" />
      <rect x="7" y="18" width="7" height="7" rx="1.2" fill="#f4fffc" opacity="0.45" />
      <rect x="18" y="18" width="7" height="7" rx="1.2" fill="#f4fffc" opacity="0.75" />
    </svg>
  )
}

export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-[1.7rem] font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-muted">{description}</p>
    </header>
  )
}

export function PanelMessage({
  title,
  body,
  onRetry,
}: {
  title: string
  body: string
  onRetry?: () => void
}) {
  return (
    <div className="rounded-xl border border-line bg-card px-5 py-4">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 text-sm font-medium text-teal">
          Try again
        </button>
      )}
    </div>
  )
}

export function StatusPill({ value }: { value: string }) {
  const quiet = value === 'active' || value === 'ready' || value === 'succeeded'
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        quiet ? 'bg-teal-soft text-teal' : 'bg-paper text-muted'
      }`}
    >
      {value}
    </span>
  )
}

export function NavIcon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  )
}

const iconPaths: Record<IconName, ReactNode> = {
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
    </>
  ),
  users: (
    <>
      <circle cx="12" cy="8" r="2.3" />
      <path d="M6.5 18.5c.8-2.8 2.8-4.2 5.5-4.2s4.7 1.4 5.5 4.2" />
    </>
  ),
  groups: (
    <>
      <circle cx="8" cy="10" r="2" />
      <circle cx="16" cy="10" r="2" />
      <circle cx="12" cy="15.5" r="2" />
    </>
  ),
  content: (
    <>
      <path d="M5 8.5 12 5l7 3.5-7 3.5-7-3.5Z" />
      <path d="M5 12.5 12 16l7-3.5" />
      <path d="M5 16.5 12 20l7-3.5" />
    </>
  ),
  studio: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 15.2 10.2 10.8 12.2 13.2 13.8 11 16 15.2" />
    </>
  ),
  jobs: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M10.2 9.4v5.2l4.4-2.6-4.4-2.6Z" fill="currentColor" stroke="none" />
    </>
  ),
  changes: (
    <>
      <path d="M7 6.5v8" />
      <circle cx="7" cy="6.5" r="1.7" />
      <circle cx="7" cy="16.5" r="1.7" />
      <circle cx="16.5" cy="11.5" r="1.7" />
      <path d="M8.6 7.4c2.4.4 4.2 1.5 6.2 4" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 8.5V12l2.6 1.8" />
    </>
  ),
  connections: (
    <>
      <circle cx="7" cy="12" r="2.2" />
      <circle cx="17" cy="12" r="2.2" />
      <path d="M9.2 12h5.6" />
    </>
  ),
  settings: (
    <>
      <path d="M4 8h9" />
      <path d="M17 8h3" />
      <circle cx="15" cy="8" r="1.7" />
      <path d="M4 16h3" />
      <path d="M11 16h9" />
      <circle cx="9" cy="16" r="1.7" />
    </>
  ),
}
