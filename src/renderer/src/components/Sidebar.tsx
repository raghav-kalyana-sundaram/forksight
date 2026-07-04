import { NavLink } from 'react-router-dom'

interface NavItem {
  to: string
  label: string
  icon: React.JSX.Element
  end?: boolean
}

function iconPath(d: string): React.JSX.Element {
  return (
    <svg
      className="h-[18px] w-[18px] shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    end: true,
    icon: iconPath('M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10')
  },
  {
    to: '/import',
    label: 'Import',
    icon: iconPath('M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2')
  },
  {
    to: '/games',
    label: 'Games',
    icon: iconPath('M4 5h16v14H4zM4 10h16M9 5v14')
  },
  {
    to: '/review',
    label: 'Game Review',
    icon: iconPath('M11 5a6 6 0 104.47 10.03L21 20.5 19.5 22l-5.47-5.53A6 6 0 0011 5z')
  },
  {
    to: '/flashcards',
    label: 'Flashcards',
    icon: iconPath('M6 4h12a1 1 0 011 1v14a1 1 0 01-1 1H6a1 1 0 01-1-1V5a1 1 0 011-1zM5 9h14')
  },
  {
    to: '/analytics',
    label: 'Analytics',
    icon: iconPath('M4 20V10m6 10V4m6 16v-7m4 7H2')
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: iconPath(
      'M12 9a3 3 0 100 6 3 3 0 000-6zm8 3a8 8 0 01-.16 1.6l2 1.55-2 3.46-2.36-.95a8 8 0 01-2.77 1.6L14.3 22h-4.6l-.41-2.74a8 8 0 01-2.77-1.6l-2.36.95-2-3.46 2-1.55A8 8 0 014 12a8 8 0 01.16-1.6l-2-1.55 2-3.46 2.36.95a8 8 0 012.77-1.6L9.7 2h4.6l.41 2.74a8 8 0 012.77 1.6l2.36-.95 2 3.46-2 1.55A8 8 0 0120 12z'
    )
  }
]

export default function Sidebar(): React.JSX.Element {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/60">
      <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
        <span className="text-2xl leading-none" aria-hidden="true">
          ♞
        </span>
        <div>
          <h1 className="text-sm font-semibold tracking-wide text-zinc-100">BlunderCheck</h1>
          <p className="text-[11px] text-zinc-500">Find it. Fix it. Drill it.</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors ${
                isActive
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100'
              }`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-zinc-800 px-5 py-4">
        <p className="text-[11px] text-zinc-600">v0.1.0 — foundation</p>
      </div>
    </aside>
  )
}
