import { TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { firebaseReady } from './firebase'
import {
  isAdminSession,
  persistAdminSection,
  readAdminRole,
  readAdminSection,
} from './adminAuth'
import AdminLogin from './AdminLogin.jsx'
import AdminLayout from './AdminLayout.jsx'
import AudiencePage from './AudiencePage.jsx'
import EditQuestionsPage from './EditQuestionsPage.jsx'
import ExperimentsPage from './ExperimentsPage.jsx'
import LessonReportsPage from './LessonReportsPage.jsx'
import QuestionsPage from './QuestionsPage.jsx'
import SettingsPage from './SettingsPage.jsx'
import UserIdeasPage from './UserIdeasPage.jsx'

export default function App() {
  const [authed, setAuthed] = useState(() => isAdminSession())
  const [adminAccess, setAdminAccess] = useState(() => readAdminRole())
  const [adminSection, setAdminSection] = useState(() => readAdminSection())
  // Questions defaults to the rich card editor; the simple read-only table
  // is a secondary view. Persisted across a refresh like the section itself.
  const [questionsViewMode, setQuestionsViewMode] = useState(() => {
    try {
      return localStorage.getItem('webportal:questions-view') === 'table'
        ? 'table'
        : 'cards'
    } catch {
      return 'cards'
    }
  })
  useEffect(() => {
    try {
      if (questionsViewMode === 'table') {
        localStorage.setItem('webportal:questions-view', 'table')
      } else {
        localStorage.removeItem('webportal:questions-view')
      }
    } catch {
      /* private mode / quota */
    }
  }, [questionsViewMode])

  const navigateAdmin = useCallback((section) => {
    if (
      readAdminRole() === 'reports' &&
      section !== 'questions' &&
      section !== 'lesson-reports'
    )
      return
    setAdminSection(section)
    persistAdminSection(section)
  }, [])

  const handleLoginSuccess = useCallback((role) => {
    setAdminAccess(role)
    setAuthed(true)
    if (role === 'reports') {
      setAdminSection('questions')
      persistAdminSection('questions')
    }
  }, [])

  const handleLogout = useCallback(() => {
    setAuthed(false)
    setAdminAccess('full')
  }, [])

  if (!firebaseReady) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-16 text-slate-900 flex items-center justify-center">
        <div className="max-w-lg rounded-2xl border border-amber-200 bg-amber-50/90 p-8 shadow-lg shadow-amber-900/5 ring-1 ring-amber-100">
          <div className="flex gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <TriangleAlert className="size-6" strokeWidth={2} aria-hidden />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-amber-950">
                Firebase not configured
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-amber-900/85">
                Copy{' '}
                <code className="rounded-md border border-amber-200/80 bg-white px-2 py-0.5 text-xs font-medium text-amber-950">
                  .env.example
                </code>{' '}
                to{' '}
                <code className="rounded-md border border-amber-200/80 bg-white px-2 py-0.5 text-xs font-medium text-amber-950">
                  .env
                </code>{' '}
                and fill in your web app config from the Firebase console
                (Project settings → Your apps).
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!authed) {
    return <AdminLogin onSuccess={handleLoginSuccess} />
  }

  const effectiveSection =
    adminAccess === 'reports' &&
    adminSection !== 'questions' &&
    adminSection !== 'lesson-reports'
      ? 'questions'
      : adminSection

  return (
    <AdminLayout
      access={adminAccess}
      activeSection={effectiveSection}
      onNavigate={navigateAdmin}
      onLogout={handleLogout}
    >
      {effectiveSection === 'questions' ? (
        questionsViewMode === 'table' ? (
          <QuestionsPage onEditClick={() => setQuestionsViewMode('cards')} />
        ) : (
          <EditQuestionsPage
            onShowTableView={() => setQuestionsViewMode('table')}
          />
        )
      ) : effectiveSection === 'lesson-reports' ? (
        <LessonReportsPage />
      ) : effectiveSection === 'user-ideas' ? (
        <UserIdeasPage />
      ) : effectiveSection === 'experiments' ? (
        <ExperimentsPage />
      ) : effectiveSection === 'settings' ? (
        <SettingsPage />
      ) : (
        <AudiencePage />
      )}
    </AdminLayout>
  )
}
