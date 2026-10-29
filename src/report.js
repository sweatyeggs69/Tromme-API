// POST /report/automix: stores an Auto Mix issue report in D1. Write-only: nothing here reads rows back.
// Every value is validated against a fixed shape, and all SQL is bound, never built from input.
const MAX_BODY_BYTES = 8192
const MAX_DETAILS = 1000
const MAX_TITLE = 200
const MAX_VALUES = 20
const PER_INSTALL_PER_HOUR = 5
const PER_IP_PER_HOUR = 15
const MAX_PER_DAY = 2000
const MAX_ROWS = 5000

const ISSUES = new Set([
  "Mix started too early", "Mix started too late", "Mix was too short", "Mix was too long",
  "Cut off the vocals", "Vocals overlapped", "Filter sound was off", "These songs should not mix",
  "These songs should have mixed", "Glitch, gap or silence", "Other"
])

const UUID = /^[0-9a-fA-F-]{36}$/
const KEY = /^\d{1,12}$/
const VALUE_NAME = /^[A-Za-z]{1,40}$/
const VERSION = /^[\w. ()-]{1,40}$/

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : null)

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("")
}

function song(value) {
  if (!value || typeof value !== "object") return null
  const key = typeof value.key === "string" ? value.key : null
  const title = text(value.title, MAX_TITLE)
  const artist = text(value.artist, MAX_TITLE)
  if (!key || !KEY.test(key) || title === null || artist === null) return null
  return { key, title, artist }
}

// Returns the cleaned report, or null when anything is off.
function parse(body) {
  if (!body || typeof body !== "object") return null
  const previous = song(body.previous)
  const current = song(body.current)
  const issue = typeof body.issue === "string" && ISSUES.has(body.issue) ? body.issue : null
  const details = text(body.details, MAX_DETAILS)
  const result = text(body.result, MAX_TITLE)
  const app = typeof body.app === "string" && VERSION.test(body.app) ? body.app : null
  const device = text(body.device, 60)
  if (!previous || !current || !issue || details === null || result === null || !app || device === null) return null
  if (typeof body.installId !== "string" || !UUID.test(body.installId)) return null

  const values = {}
  const entries = Object.entries(body.values && typeof body.values === "object" ? body.values : {})
  if (entries.length > MAX_VALUES) return null
  for (const [name, value] of entries) {
    if (!VALUE_NAME.test(name) || typeof value !== "string") return null
    values[name] = value.slice(0, 40)
  }
  return { previous, current, issue, details, result, app, device, plus: body.plus === true ? 1 : 0, installId: body.installId, values }
}

export async function handleReport(request, env) {
  const json = (body, status, headers = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } })

  if (request.method !== "POST") return json({ error: "method not allowed" }, 405, { allow: "POST" })
  if (!env.DB) return json({ error: "not configured" }, 503)
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad content type" }, 415)
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "too large" }, 413)

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown"
  if (env.REPORT_LIMITER) {
    const { success } = await env.REPORT_LIMITER.limit({ key: ip })
    if (!success) return json({ error: "rate limited" }, 429, { "retry-after": "60" })
  }

  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) return json({ error: "too large" }, 413)
  let body
  try { body = JSON.parse(raw) } catch { return json({ error: "bad json" }, 400) }
  const report = parse(body)
  if (!report) return json({ error: "bad report" }, 400)

  const now = Math.floor(Date.now() / 1000)
  const clientHash = await sha256(`install:${report.installId}`)
  const ipHash = await sha256(`ip:${ip}`)

  const counts = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN created_at > ?1 AND client_hash = ?3 THEN 1 ELSE 0 END) AS install_hour,
       SUM(CASE WHEN created_at > ?1 AND ip_hash = ?4 THEN 1 ELSE 0 END) AS ip_hour,
       SUM(CASE WHEN created_at > ?2 THEN 1 ELSE 0 END) AS day
     FROM automix_reports WHERE created_at > ?2`
  ).bind(now - 3600, now - 86400, clientHash, ipHash).first()
  if ((counts?.install_hour ?? 0) >= PER_INSTALL_PER_HOUR || (counts?.ip_hour ?? 0) >= PER_IP_PER_HOUR) {
    return json({ error: "too many reports" }, 429, { "retry-after": "3600" })
  }
  if ((counts?.day ?? 0) >= MAX_PER_DAY) return json({ error: "try again later" }, 503, { "retry-after": "3600" })

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO automix_reports (created_at, client_hash, ip_hash, issue, details, previous_key, previous_title, previous_artist,
         current_key, current_title, current_artist, result, diagnostics, app_version, device, plus)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`
    ).bind(now, clientHash, ipHash, report.issue, report.details, report.previous.key, report.previous.title, report.previous.artist,
      report.current.key, report.current.title, report.current.artist, report.result, JSON.stringify(report.values), report.app, report.device, report.plus),
    // Keeps the table bounded however many reports arrive.
    env.DB.prepare(`DELETE FROM automix_reports WHERE id <= (SELECT MAX(id) FROM automix_reports) - ?1`).bind(MAX_ROWS)
  ])
  return json({ ok: true }, 201)
}
