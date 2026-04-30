import {
  Database,
  LayoutDashboard,
  LogOut,
  MessageCircleQuestion,
  Settings,
  UsersRound,
} from 'lucide-react'
import { clearAdminSession } from './adminAuth'

/** @typedef {'users' | 'questions' | 'settings'} AdminSection */

/** @typedef {'full' | 'reports'} AdminAccess */

const navItemsAll = /** @type {const} */ ([
  { id: 'users', label: 'Users', icon: UsersRound },
  { id: 'questions', label: 'Questions', icon: MessageCircleQuestion },
  { id: 'settings', label: 'Settings', icon: Settings },
])

/**
 * @param {{
 *   children: import('react').ReactNode
 *   onLogout: () => void
 *   activeSection: AdminSection
 *   onNavigate: (section: AdminSection) => void
 *   access: AdminAccess
 * }} props
 */
export default function AdminLayout({
  children,
  onLogout,
  activeSection,
  onNavigate,
  access,
}) {
  function handleLogout() {
    clearAdminSession()
    onLogout()
  }

  const navItems =
    access === 'reports'
      ? navItemsAll.filter((item) => item.id === 'questions')
      : navItemsAll

  const headerSubtitle =
    access === 'reports'
      ? 'Reported questions — review and resolve issues'
      : activeSection === 'questions'
        ? 'Browse Firestore questions'
        : activeSection === 'settings'
          ? 'Remote config in Firestore'
          : 'Filter users by onboarding and export CSV'

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-900">
      <aside
        className="flex w-[16rem] shrink-0 flex-col border-r border-slate-200/80 bg-white shadow-[1px_0_0_rgba(15,23,42,0.04)]"
        aria-label="Main navigation"
      >
        <div className="border-b border-slate-100 px-5 py-5">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-900/20">
              <LayoutDashboard className="size-5 shrink-0" strokeWidth={2} />
            </div>
            <div className="min-w-0 pt-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                {access === 'reports' ? 'Questions reviewer' : 'Admin'}
              </p>
              <p className="mt-0.5 text-lg font-semibold tracking-tight text-slate-900">
                Web portal
              </p>
            </div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Sections">
          {navItems.map((item) => {
            const active = activeSection === item.id
            const NavIcon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${
                  active
                    ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/90 shadow-sm shadow-emerald-900/5'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <NavIcon
                  className={`size-4 shrink-0 ${active ? 'text-emerald-700' : 'text-slate-400'}`}
                  strokeWidth={2}
                />
                {item.label}
              </button>
            )
          })}
        </nav>
        <div className="mt-auto border-t border-slate-100 p-3">
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl border border-transparent px-3 py-2.5 text-left text-sm font-medium text-slate-600 transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            <LogOut className="size-4 shrink-0 text-slate-400" strokeWidth={2} />
            Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-[3.25rem] shrink-0 items-center justify-between gap-4 border-b border-slate-200/90 bg-white/90 px-4 backdrop-blur-md sm:px-6">
          <p className="flex min-w-0 items-center gap-2 truncate text-sm text-slate-600">
            <Database
              className="size-4 shrink-0 text-emerald-600"
              strokeWidth={2}
              aria-hidden
            />
            <span className="truncate">{headerSubtitle}</span>
          </p>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Log out of admin panel"
            className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 sm:px-4"
          >
            <LogOut className="size-4 text-slate-500" strokeWidth={2} aria-hidden />
            Log out
          </button>
        </header>
        <main className="min-w-0 flex-1 overflow-auto bg-slate-50">{children}</main>
      </div>
    </div>
  )
}
