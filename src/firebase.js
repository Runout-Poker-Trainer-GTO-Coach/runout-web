import { initializeApp } from 'firebase/app'
import { getAnalytics, isSupported } from 'firebase/analytics'
import { getFirestore } from 'firebase/firestore'

const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID?.trim()

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  ...(measurementId ? { measurementId } : {}),
}

function isConfigComplete(config) {
  return Object.values(config).every((v) => v != null && String(v).trim() !== '')
}

export const firebaseReady = isConfigComplete(firebaseConfig)

export const app = firebaseReady ? initializeApp(firebaseConfig) : null
export const db = firebaseReady ? getFirestore(app) : null

/** Resolved when Analytics is available (browser + supported environment). */
export const analyticsPromise =
  firebaseReady &&
  app &&
  typeof window !== 'undefined' &&
  measurementId
    ? isSupported().then((ok) => (ok ? getAnalytics(app) : null))
    : Promise.resolve(null)

export const usersCollectionName =
  import.meta.env.VITE_FIRESTORE_USERS_COLLECTION?.trim() || 'users'

export const questionsCollectionName =
  import.meta.env.VITE_FIRESTORE_QUESTIONS_COLLECTION?.trim() || 'questions'

export const lessonReportsCollectionName =
  import.meta.env.VITE_FIRESTORE_LESSON_REPORTS_COLLECTION?.trim() ||
  'lesson-reports'

export const beginnerFlowReportsCollectionName =
  import.meta.env.VITE_FIRESTORE_BEGINNER_FLOW_REPORTS_COLLECTION?.trim() ||
  'learn-session-reports'

export const userIdeasCollectionName =
  import.meta.env.VITE_FIRESTORE_USER_IDEAS_COLLECTION?.trim() || 'user-ideas'

/** Single document for app-wide remote config (e.g. discount UI flags). */
export const settingsCollectionName =
  import.meta.env.VITE_FIRESTORE_SETTINGS_COLLECTION?.trim() || 'config'
export const settingsDocumentId =
  import.meta.env.VITE_FIRESTORE_SETTINGS_DOC_ID?.trim() || 'app'
