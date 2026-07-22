import axios from 'axios'

const DELETE_USER_ENDPOINT =
  'https://us-central1-poker-runout.cloudfunctions.net/deleteUser'

/**
 * Calls the `deleteUser` Cloud Function to delete a user's Firebase Auth
 * account (and whatever server-side data the function itself removes).
 * There is no undo from this app once the function responds successfully.
 *
 * @param {object} opts
 * @param {string} opts.token Bearer token (VITE_DELETE_USER_API_TOKEN)
 * @param {string} opts.uuid Firebase Auth UID — same value as the Firestore doc id
 */
export async function deleteUserAccount({ token, uuid }) {
  await axios.post(
    DELETE_USER_ENDPOINT,
    { uuid },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    },
  )
}
