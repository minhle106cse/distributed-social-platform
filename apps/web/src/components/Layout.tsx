import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'

const nav = [
  { to: '/search', label: 'Search', icon: '🔍' },
  { to: '/knowledge', label: 'Knowledge', icon: '📄' },
  { to: '/notifications', label: 'Notifications', icon: '🔔' },
]

export function Layout() {
  const navigate = useNavigate()
  const { email, orgId, logout } = useAuth()

  return (
    <div className="flex h-full">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="px-5 py-5">
          <div className="text-lg font-bold text-brand-600">Cortex</div>
          <div className="text-xs text-slate-400">Team Knowledge Hub</div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              <span>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 px-5 py-4 text-xs">
          <div className="truncate text-slate-500">{email ?? 'signed in'}</div>
          <div className="mt-1 truncate text-[10px] text-slate-400">org: {orgId ?? '—'}</div>
          <button
            onClick={() => {
              logout()
              navigate('/login')
            }}
            className="mt-2 text-slate-400 hover:text-slate-600"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
