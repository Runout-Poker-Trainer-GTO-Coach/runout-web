const STORAGE_KEY = 'webportal_admin_session'
const SECTION_KEY = 'webportal_admin_section'
const ROLE_KEY = 'webportal_admin_role'

/** @typedef {'full' | 'reports'} AdminRole */

export function isAdminSession() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * @returns {AdminRole}
 */
export function readAdminRole() {
  try {
    const v = sessionStorage.getItem(ROLE_KEY)
    if (v === 'full' || v === 'reports') return v
  } catch {
    /* ignore */
  }
  return 'full'
}

/**
 * @param {AdminRole} [role]
 */
export function setAdminSession(role = 'full') {
  const r = role === 'reports' ? 'reports' : 'full'
  sessionStorage.setItem(STORAGE_KEY, '1')
  sessionStorage.setItem(ROLE_KEY, r)
  if (r === 'reports') {
    persistAdminSection('questions')
  }
}

export function clearAdminSession() {
  sessionStorage.removeItem(STORAGE_KEY)
  sessionStorage.removeItem(ROLE_KEY)
  try {
    sessionStorage.removeItem(SECTION_KEY)
  } catch {
    /* ignore */
  }
}

/** @typedef {'users' | 'questions' | 'lesson-reports' | 'beginner-flow-reports' | 'user-ideas' | 'glossary' | 'experiments' | 'experiment-results' | 'settings'} AdminSection */

/** @returns {AdminSection} */
export function readAdminSection() {
  let section = /** @type {AdminSection} */ ('users')
  try {
    const v = sessionStorage.getItem(SECTION_KEY)
    if (v === 'questions') section = 'questions'
    else if (v === 'lesson-reports') section = 'lesson-reports'
    else if (v === 'beginner-flow-reports') section = 'beginner-flow-reports'
    else if (v === 'user-ideas') section = 'user-ideas'
    else if (v === 'glossary') section = 'glossary'
    else if (v === 'experiments') section = 'experiments'
    else if (v === 'experiment-results') section = 'experiment-results'
    else if (v === 'settings') section = 'settings'
    else if (v === 'users' || v === 'audience') section = 'users'
  } catch {
    /* ignore */
  }
  if (
    readAdminRole() === 'reports' &&
    section !== 'questions' &&
    section !== 'lesson-reports'
  ) {
    return 'questions'
  }
  return section
}

/** @param {AdminSection} section */
export function persistAdminSection(section) {
  try {
    if (
      section === 'users' ||
      section === 'questions' ||
      section === 'lesson-reports' ||
      section === 'beginner-flow-reports' ||
      section === 'user-ideas' ||
      section === 'glossary' ||
      section === 'experiments' ||
      section === 'experiment-results' ||
      section === 'settings'
    ) {
      sessionStorage.setItem(SECTION_KEY, section)
    }
  } catch {
    /* ignore */
  }
}
