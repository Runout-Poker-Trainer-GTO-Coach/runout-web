import {
  BookOpen,
  ChevronRight,
  FlaskConical,
  LogOut,
  MessageCircleQuestion,
  MessageSquareWarning,
  Settings,
  Sparkles,
  UsersRound,
  Zap,
} from 'lucide-react'
import { clearAdminSession } from './adminAuth'

/** @typedef {'users' | 'questions' | 'lesson-reports' | 'beginner-flow-reports' | 'user-ideas' | 'experiments' | 'settings'} AdminSection */

/** @typedef {'full' | 'reports'} AdminAccess */

const navItemsAll = /** @type {const} */ ([
  { id: 'users', label: 'Users', icon: UsersRound },
  { id: 'questions', label: 'Questions', icon: MessageCircleQuestion },
  { id: 'lesson-reports', label: 'Lesson reports', icon: BookOpen },
  { id: 'beginner-flow-reports', label: 'Beginner Flow Reports', icon: MessageSquareWarning },
  { id: 'user-ideas', label: 'User Ideas', icon: Sparkles },
  { id: 'experiments', label: 'Experiments', icon: FlaskConical },
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
      ? navItemsAll.filter(
          (item) => item.id === 'questions' || item.id === 'lesson-reports',
        )
      : navItemsAll

  const activeItem = navItemsAll.find((item) => item.id === activeSection)

  const headerSubtitle =
    activeSection === 'lesson-reports'
      ? 'Review and resolve slide issues'
      : access === 'reports'
        ? 'Review and resolve reported questions'
        : activeSection === 'questions'
          ? 'Browse Firestore questions'
          : activeSection === 'beginner-flow-reports'
            ? 'Issues reported from the beginner learn flow'
            : activeSection === 'user-ideas'
              ? 'Ideas (pending) vs. Added (shipped)'
              : activeSection === 'experiments'
                ? 'Paywall A/B tests (admin only)'
                : activeSection === 'settings'
                  ? 'Remote config in Firestore'
                  : 'Filter users by onboarding and export CSV'

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside
        className="flex w-64 shrink-0 flex-col border-r border-slate-200/70 bg-white"
        aria-label="Main navigation"
      >
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
            <Zap className="size-4.5 shrink-0" strokeWidth={2.25} aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold tracking-tight text-slate-900">
              Web portal
            </p>
            <p className="truncate text-[11px] font-medium text-slate-400">
              {access === 'reports' ? 'Questions reviewer' : 'Admin'}
            </p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Sections">
          {navItems.map((item) => {
            const active = activeSection === item.id
            const NavIcon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${
                  active
                    ? 'bg-emerald-50 text-emerald-950'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span
                  className={`absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-emerald-500 transition-opacity ${
                    active ? 'opacity-100' : 'opacity-0'
                  }`}
                  aria-hidden
                />
                <NavIcon
                  className={`size-[17px] shrink-0 ${active ? 'text-emerald-600' : 'text-slate-400 group-hover:text-slate-500'}`}
                  strokeWidth={2}
                />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="border-t border-slate-100 p-3">
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            <LogOut className="size-[17px] shrink-0 text-slate-400" strokeWidth={2} />
            Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200/70 bg-white/80 px-6 backdrop-blur-md">
          <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-slate-500">
            <span className="font-medium text-slate-700">
              {activeItem?.label ?? 'Users'}
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-slate-300" strokeWidth={2} aria-hidden />
            <span className="truncate text-slate-500">{headerSubtitle}</span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Log out of admin panel"
            className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            <LogOut className="size-3.5 text-slate-400" strokeWidth={2} aria-hidden />
            Log out
          </button>
        </header>
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
