import { DurableObject } from "cloudflare:workers"

// One global instance shares a token bucket per lane across every client. Bulk work (library cleanup,
// new-album automation) draws from it so it can never starve normal app lookups or the shared Last.fm key.
export const BULK_BUDGETS = { appleart: 60, lastfm: 120 }
const BURST_SECONDS = 5

export class BulkBudget extends DurableObject {
  buckets = new Map()

  take(lane, perMinute) {
    const now = Date.now()
    const ratePerMs = perMinute / 60000
    const capacity = Math.max(1, Math.floor(perMinute * BURST_SECONDS / 60))
    const bucket = this.buckets.get(lane) ?? { tokens: capacity, at: now }
    bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.at) * ratePerMs)
    bucket.at = now
    this.buckets.set(lane, bucket)
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return { ok: true }
    }
    return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - bucket.tokens) / ratePerMs / 1000)) }
  }
}
