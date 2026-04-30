import axios from 'axios'

const RC_BASE = 'https://api.revenuecat.com'

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  }
}

/**
 * GET /v2/projects/{project_id}/customers/{customer_id}/subscriptions
 * Follows next_page until exhausted.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.projectId
 * @param {string} opts.customerId - same as your app user id / Firestore doc id
 * @param {{ limit?: number }} [opts.params]
 */
async function fetchCustomerSubscriptionsAllPages({
  apiKey,
  projectId,
  customerId,
  params = { limit: 1 },
}) {
  const basePath = `/v2/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(customerId)}/subscriptions`
  const allItems = []
  let nextUrl = `${RC_BASE}${basePath}`
  let first = true

  const { data } = await axios.get(nextUrl, {
    headers: authHeaders(apiKey),
    ...(first ? { params } : {}),
  })
  first = false

  if (Array.isArray(data.items)) allItems.push(...data.items)

  return allItems
}

/**
 * True if any subscription currently grants access (RevenueCat v2 fields).
 * @param {object[]} items
 */
function subscriptionsIndicatePurchase(items) {
  if (!Array.isArray(items) || items.length === 0) return false
  return items.some((sub) => {
    if (!sub || typeof sub !== 'object') return false
    if (sub.gives_access !== true) return false
    const ends = sub.ends_at
    if (ends != null && Number(ends) <= Date.now()) return false
    return true
  })
}

/**
 * For each customer id, fetch subscriptions and return whether they should count as purchased.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.projectId
 * @param {string[]} opts.customerIds
 * @param {number} [opts.concurrency]
 * @param {(customerId: string, purchased: boolean) => void} [opts.onProgress] — called as each id finishes
 * @returns {Promise<Map<string, boolean>>}
 */
async function fetchPurchaseStatusBySubscriptions({
  apiKey,
  projectId,
  customerIds,
  concurrency = 5,
  onProgress,
}) {
  const map = new Map()
  if (customerIds.length === 0) return map

  let index = 0

  async function worker() {
    while (index < customerIds.length) {
      const i = index++
      const id = customerIds[i]
      let purchased = false
      try {
        const items = await fetchCustomerSubscriptionsAllPages({
          apiKey,
          projectId,
          customerId: id,
        })
        purchased = subscriptionsIndicatePurchase(items)
        map.set(id, purchased)
      } catch (e) {
        const status = e?.response?.status
        purchased = false
        map.set(id, false)
        if (status !== 404 && status !== 422) {
          console.warn(
            `[RevenueCat] subscriptions for ${id}:`,
            e?.message || e,
          )
        }
      }
      onProgress?.(id, purchased)
    }
  }

  const n = Math.min(concurrency, customerIds.length)
  await Promise.all(Array.from({ length: n }, () => worker()))

  return map
}

/**
 * @deprecated List customers — prefer subscriptions per user.
 */
async function fetchCustomersPage({ apiKey, projectId, params = {} }) {
  const url = `${RC_BASE}/v2/projects/${encodeURIComponent(projectId)}/customers`
  const { data } = await axios.get(url, {
    headers: authHeaders(apiKey),
    params,
  })
  return data
}

async function fetchAllCustomers({ apiKey, projectId, params = {} }) {
  const all = []
  const seen = new Set()
  let nextAbsoluteUrl = null
  let first = true

  while (true) {
    const { data } = first
      ? await axios.get(
        `${RC_BASE}/v2/projects/${encodeURIComponent(projectId)}/customers`,
        { headers: authHeaders(apiKey), params },
      )
      : await axios.get(nextAbsoluteUrl, { headers: authHeaders(apiKey) })

    const pageKey = first ? `__first__:${JSON.stringify(params)}` : nextAbsoluteUrl
    if (seen.has(pageKey)) break
    seen.add(pageKey)
    first = false

    if (Array.isArray(data.items)) all.push(...data.items)

    const next = data.next_page
    if (!next || typeof next !== 'string') break
    nextAbsoluteUrl = next.startsWith('http') ? next : `${RC_BASE}${next}`
  }

  return all
}

export {
  RC_BASE,
  fetchCustomersPage,
  fetchAllCustomers,
  fetchCustomerSubscriptionsAllPages,
  fetchPurchaseStatusBySubscriptions,
  subscriptionsIndicatePurchase,
}
