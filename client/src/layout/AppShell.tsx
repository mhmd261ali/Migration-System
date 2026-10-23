import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useSession } from '../auth/AuthProvider'
import { Mark, NavIcon } from '../components/ui'
import { initials } from '../format'
import { navItems, navigation } from '../nav'

const STORAGE_KEY = 'migration.sidebar'

export function AppShell() {
  const { pathname } = useLocation()
  const current = navItems.find((item) => item.to === pathname)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === 'collapsed')

  useEffect(() => {
    document.title = current ? `${current.label} · Migration System` : 'Migration System'
  }, [current])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? 'collapsed' : 'expanded')
  }, [collapsed])

  return (
    <div className="min-h-screen bg-paper md:flex">
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-text transition-[width] duration-200 ease-out md:flex ${
          collapsed ? 'w-[88px]' : 'w-[248px]'
        }`}
      >
        <Brand collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
        <nav className={`flex-1 overflow-y-auto pb-4 ${collapsed ? 'px-2' : 'px-3'}`} aria-label="Primary">
          <NavLinks collapsed={collapsed} />
        </nav>
        <Account collapsed={collapsed} />
      </aside>
      <div className="min-w-0 flex-1">
        <MobileNav current={current?.label ?? 'Menu'} />
        <main className="px-5 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function Brand({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <div className={`flex items-center py-4 ${collapsed ? 'justify-between px-2' : 'gap-3 px-4'}`}>
      <Mark className="h-8 w-8 shrink-0" />
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-foam">RD-NEW</p>
          <p className="text-[15px] font-semibold leading-tight text-white">Migration System</p>
        </div>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sidebar-text/80 hover:bg-white/10 hover:text-white"
      >
        <CollapseIcon collapsed={collapsed} />
      </button>
    </div>
  )
}

function NavLinks({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  return (
    <div>
      {navigation.map((section) => (
        <div key={section.label} className={collapsed ? 'pt-3' : undefined}>
          <p
            className={
              collapsed
                ? 'sr-only'
                : 'px-3 pb-1 pt-5 text-[11px] font-medium uppercase tracking-[0.14em] text-sidebar-text/50'
            }
          >
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  title={collapsed ? item.label : undefined}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `flex items-center rounded-lg py-2 text-sm ${
                      collapsed ? 'justify-center px-0' : 'gap-2.5 px-3'
                    } ${
                      isActive
                        ? 'bg-white/10 font-medium text-white'
                        : 'text-sidebar-text/80 hover:bg-white/5 hover:text-white'
                    }`
                  }
                >
                  <NavIcon name={item.icon} />
                  <span className={collapsed ? 'sr-only' : undefined}>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function Account({ collapsed = false }: { collapsed?: boolean }) {
  const session = useSession()
  return (
    <div
      className={`border-t border-white/10 ${
        collapsed ? 'flex flex-col items-center gap-2 px-2 py-3' : 'flex items-center gap-3 px-4 py-4'
      }`}
    >
      <div
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-teal text-xs font-semibold text-white"
        title={collapsed ? session.name : undefined}
      >
        {initials(session.name)}
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{session.name}</p>
          <button
            type="button"
            onClick={session.signOut}
            className="text-xs text-sidebar-text/70 hover:text-white"
          >
            Sign out
          </button>
        </div>
      )}
      {collapsed && (
        <button
          type="button"
          onClick={session.signOut}
          aria-label="Sign out"
          title="Sign out"
          className="grid h-8 w-8 place-items-center rounded-lg text-sidebar-text/80 hover:bg-white/10 hover:text-white"
        >
          <SignOutIcon />
        </button>
      )}
    </div>
  )
}

function MobileNav({ current }: { current: string }) {
  return (
    <details className="border-b border-white/10 bg-sidebar text-sidebar-text md:hidden">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-white">
        <span className="flex items-center gap-2">
          <Mark className="h-6 w-6" />
          {current}
        </span>
        <span className="text-xs text-sidebar-text/70">Menu</span>
      </summary>
      <div className="px-2 pb-3">
        <NavLinks
          onNavigate={() => {
            const menu = document.querySelector('details')
            if (menu) menu.open = false
          }}
        />
        <div className="px-3 pt-3">
          <Account />
        </div>
      </div>
    </details>
  )
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path
        d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h6A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 10 18.5V17" strokeLinecap="round" />
      <path d="M4 12h10" strokeLinecap="round" />
      <path d="M11 9l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
