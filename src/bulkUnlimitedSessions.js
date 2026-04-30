/**
 * Bulk unlimited-session updates for the Settings page.
 * @see USER_AUTO_UNLIMITED_FIELD — marks users who received unlimited via the global toggle
 *   (manual per-user toggles clear this flag).
 */
import {
  collection,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore'

/** Firestore field on user docs — true when unlimited was granted by “all unlimited” in Settings. */
export const USER_AUTO_UNLIMITED_FIELD = 'autoUnlimitedSession'

const MAX_BATCH = 500

/**
 * Grant unlimited to every user who is not already unlimited (manual unlimited is left unchanged).
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} usersCollectionName
 */
export async function applyBulkUnlimitedEnable(db, usersCollectionName) {
  const snap = await getDocs(collection(db, usersCollectionName))
  /** @type {import('firebase/firestore').WriteBatch | null} */
  let batch = writeBatch(db)
  let n = 0
  const commit = async () => {
    if (n === 0) return
    await batch.commit()
    batch = writeBatch(db)
    n = 0
  }
  for (const d of snap.docs) {
    const data = d.data()
    if (data.canDoUnlimitedSessions === true) continue
    batch.update(d.ref, {
      canDoUnlimitedSessions: true,
      [USER_AUTO_UNLIMITED_FIELD]: true,
    })
    n++
    if (n >= MAX_BATCH) await commit()
  }
  await commit()
}

/**
 * Remove unlimited only from users flagged with {@link USER_AUTO_UNLIMITED_FIELD}.
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} usersCollectionName
 */
export async function applyBulkUnlimitedDisable(db, usersCollectionName) {
  const q = query(
    collection(db, usersCollectionName),
    where(USER_AUTO_UNLIMITED_FIELD, '==', true),
  )
  const snap = await getDocs(q)
  /** @type {import('firebase/firestore').WriteBatch | null} */
  let batch = writeBatch(db)
  let n = 0
  const commit = async () => {
    if (n === 0) return
    await batch.commit()
    batch = writeBatch(db)
    n = 0
  }
  for (const d of snap.docs) {
    batch.update(d.ref, {
      canDoUnlimitedSessions: false,
      [USER_AUTO_UNLIMITED_FIELD]: false,
    })
    n++
    if (n >= MAX_BATCH) await commit()
  }
  await commit()
}
