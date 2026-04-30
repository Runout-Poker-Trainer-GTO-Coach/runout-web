import {
  AlertCircle,
  ArrowRight,
  KeyRound,
  Laptop,
  ShieldCheck,
  User,
} from 'lucide-react'
import { useState } from 'react'
import { setAdminSession } from './adminAuth'

function trimStr(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * @returns {{
 *   fullUser: string
 *   reportsUser: string
 *   fullPassword: string
 *   reportsPassword: string
 *   legacyPasswordOnly: boolean
 * }}
 */
function adminAuthConfigFromEnv() {
  const legacy = trimStr(
    import.meta.env.ADMIN_PASSWORD ?? import.meta.env.VITE_ADMIN_PASSWORD ?? '',
  )
  const fullExplicit = trimStr(import.meta.env.VITE_ADMIN_FULL_PASSWORD ?? '')
  const reportsPass = trimStr(import.meta.env.VITE_ADMIN_REPORTS_PASSWORD ?? '')

  const fullUser = trimStr(import.meta.env.VITE_ADMIN_FULL_USERNAME ?? '') || 'runout'
  const reportsUser =
    trimStr(import.meta.env.VITE_ADMIN_REPORTS_USERNAME ?? '') || 'admin'

  const fullPassword = fullExplicit || legacy
  const legacyPasswordOnly =
    Boolean(legacy) && !fullExplicit && reportsPass.length === 0

  return {
    fullUser,
    reportsUser,
    fullPassword,
    reportsPassword: reportsPass,
    legacyPasswordOnly,
  }
}

/**
 * @param {{ onSuccess: (role: 'full' | 'reports') => void }} props
 */
export default function AdminLogin({ onSuccess }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)

  const cfg = adminAuthConfigFromEnv()
  const reportsConfigured = cfg.reportsPassword.length > 0
  const fullConfigured = cfg.fullPassword.length > 0
  const configured = fullConfigured || reportsConfigured

  function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!configured) {
      setError(
        'Admin login is not configured. Set VITE_ADMIN_PASSWORD (full access) and/or VITE_ADMIN_REPORTS_PASSWORD (questions-only) in .env — see .env.example.',
      )
      return
    }

    const u = username.trim()
    const p = password

    if (reportsConfigured && u === cfg.reportsUser && p === cfg.reportsPassword) {
      setAdminSession('reports')
      onSuccess('reports')
      return
    }

    if (fullConfigured) {
      const userOk =
        u === cfg.fullUser || (cfg.legacyPasswordOnly && u === '')
      if (userOk && p === cfg.fullPassword) {
        setAdminSession('full')
        onSuccess('full')
        return
      }
    }

    setError('Incorrect username or password.')
    setPassword('')
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 via-white to-emerald-50/30 px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto flex w-full max-w-md flex-col items-center">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-900/25 ring-4 ring-white">
            <ShieldCheck className="size-7" strokeWidth={1.75} aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Admin sign in
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Sign in with your admin username and password.
          </p>
        </div>

        <div className="w-full rounded-2xl border border-slate-200/90 bg-white p-8 shadow-xl shadow-slate-900/[0.06] ring-1 ring-slate-900/[0.03]">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="admin-username"
                className="flex items-center gap-2 text-sm font-medium text-slate-700"
              >
                <User className="size-4 text-slate-400" strokeWidth={2} />
                Username
              </label>
              <input
                id="admin-username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-500/15"
                placeholder={
                  cfg.legacyPasswordOnly
                    ? 'Optional for legacy password-only login'
                    : 'e.g. runout or admin'
                }
                autoFocus={!cfg.legacyPasswordOnly}
              />
            </div>
            <div>
              <label
                htmlFor="admin-password"
                className="flex items-center gap-2 text-sm font-medium text-slate-700"
              >
                <KeyRound className="size-4 text-slate-400" strokeWidth={2} />
                Password
              </label>
              <input
                id="admin-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-500/15"
                placeholder="••••••••"
                autoFocus={cfg.legacyPasswordOnly}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="flex gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                <AlertCircle
                  className="mt-0.5 size-4 shrink-0 text-red-600"
                  strokeWidth={2}
                />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-md shadow-emerald-900/20 transition hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
            >
              Continue
              <ArrowRight className="size-4" strokeWidth={2} aria-hidden />
            </button>
          </form>
        </div>

        <p className="mt-8 flex max-w-sm items-start gap-2 text-center text-xs leading-relaxed text-slate-500">
          <Laptop
            className="mx-auto mt-0.5 size-4 shrink-0 text-slate-400 sm:mx-0"
            strokeWidth={2}
            aria-hidden
          />
          <span>
            Session stays in this browser only. Use{' '}
            <strong className="font-medium text-slate-600">Log out</strong> on
            shared devices.
          </span>
        </p>
      </div>
    </div>
  )
}
