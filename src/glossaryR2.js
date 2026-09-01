/**
 * Publishes the glossary JSON directly to the R2 bucket from the browser,
 * using credentials the admin pastes in for that session only (see
 * GlossaryUploadModal). Nothing here is bundled with a secret — the key
 * only ever exists in memory/sessionStorage on the admin's own machine.
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const GLOSSARY_KEY = 'glossary/pokerGlossary.en.json'

/**
 * @typedef {{
 *   accountId: string
 *   accessKeyId: string
 *   secretAccessKey: string
 *   bucketName: string
 * }} R2Credentials
 */

/**
 * @param {Array<Record<string, string>>} entries
 * @param {R2Credentials} creds
 */
export async function publishGlossaryToR2(entries, creds) {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${creds.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
  })

  const body = JSON.stringify(entries, null, 2)

  await client.send(
    new PutObjectCommand({
      Bucket: creds.bucketName,
      Key: GLOSSARY_KEY,
      Body: body,
      ContentType: 'application/json',
    }),
  )
}
