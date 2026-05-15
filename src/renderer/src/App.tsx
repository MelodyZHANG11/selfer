import { NavLink, Outlet } from 'react-router-dom'
import { BarChart3, BookOpen, MessagesSquare, Settings } from 'lucide-react'
import logoUrl from './assets/logo.png'
import { StatusBar } from './components/StatusBar'

export function App(): JSX.Element {
  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100">
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-52 shrink-0 border-r border-neutral-800/80 bg-neutral-950/80 backdrop-blur flex flex-col">
        <div
          className="h-12 flex items-center gap-2 pl-20 pr-4 border-b border-neutral-800/80 select-none"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <img
            src={logoUrl}
            alt="Selfer"
            className="w-6 h-6 shrink-0 invert rounded-md"
            draggable={false}
          />
          <span className="font-semibold tracking-tight text-sm text-neutral-100">
            selfer
          </span>
        </div>
        <nav className="flex-1 p-2 flex flex-col gap-0.5 text-sm">
          <NavItem to="/sessions" icon={<MessagesSquare size={15} />} label="Sessions" />
          <NavItem to="/stats" icon={<BarChart3 size={15} />} label="Stats" />
          <NavItem to="/digests" icon={<BookOpen size={15} />} label="Digests" />
          <NavItem to="/settings" icon={<Settings size={15} />} label="Settings" />
        </nav>
        <div className="p-3 text-[10px] text-neutral-600 border-t border-neutral-900">
          v0.1 · local-first
        </div>
      </aside>
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <StatusBar />
    </div>
  )
}

function NavItem({
  to,
  icon,
  label
}: {
  to: string
  icon: JSX.Element
  label: string
}): JSX.Element {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-1.5 rounded-md transition-colors ${
          isActive
            ? 'bg-neutral-800/80 text-white'
            : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
        }`
      }
    >
      <span className="opacity-90">{icon}</span>
      <span>{label}</span>
    </NavLink>
  )
}
