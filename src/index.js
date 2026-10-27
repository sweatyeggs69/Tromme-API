import { routes, MAX_PARAM_LENGTH } from "./routes.js"

const json = (body, status, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  })

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET") {
      return json({ error: "method not allowed" }, 405, { allow: "GET" })
    }

    const url = new URL(request.url)
    const route = routes[url.pathname]
    if (!route) return json({ error: "not found" }, 404)

    const apiKey = route.secret ? env[route.secret] : undefined
    if (route.secret && !apiKey) return json({ error: "not configured" }, 503)

    // Build the upstream query from the whitelist only.
    const query = new URLSearchParams()
    for (const [name, rule] of Object.entries(route.params)) {
      const value = url.searchParams.get(name)?.trim()
      if (!value) {
        if (rule.required) return json({ error: `missing ${name}` }, 400)
        continue
      }
      if (value.length > MAX_PARAM_LENGTH) return json({ error: `${name} too long` }, 400)
      if (rule.pattern && !rule.pattern.test(value)) return json({ error: `bad ${name}` }, 400)
      query.set(name, value)
    }
    if (route.requireOne && ![...query.keys()].length) return json({ error: "missing params" }, 400)
    for (const [name, value] of Object.entries(route.fixed)) query.set(name, value)
    query.sort()

    // The cache key never contains the secret.
    const cacheKey = new Request(`https://api.tromme.app${url.pathname}?${query}`)
    const cache = caches.default
    const cached = await cache.match(cacheKey)
    if (cached) return cached

    const ip = request.headers.get("cf-connecting-ip") ?? "unknown"
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: ip })
      if (!success) return json({ error: "rate limited" }, 429, { "retry-after": "60" })
    }

    const upstreamQuery = new URLSearchParams(query)
    let upstreamPath = route.upstream
    for (const [name, rule] of Object.entries(route.params)) {
      if (!rule.inPath) continue
      upstreamPath = upstreamPath.replace(`{${name}}`, encodeURIComponent(query.get(name)))
      upstreamQuery.delete(name)
    }
    const upstream = new URL(upstreamPath)
    upstream.search = upstreamQuery.toString()
    if (apiKey) upstream.searchParams.set(route.keyParam, apiKey)

    const headers = { accept: "*/*", "user-agent": "Tromme (https://tromme.app)" }
    const originSecret = route.originSecret ? env[route.originSecret] : undefined
    if (originSecret) headers["x-origin-secret"] = originSecret

    let upstreamResponse
    try {
      upstreamResponse = await fetch(upstream, { headers })
    } catch {
      return json({ error: "upstream unreachable" }, 502)
    }

    if (!upstreamResponse.ok) console.log(`upstream ${upstreamResponse.status} ${url.pathname}?${query}`)

    // Pass the body through untouched so the app's decoders keep working. Only successes are cached,
    // plus 404s on routes that set negativeTtl.
    const cacheable = upstreamResponse.ok || (upstreamResponse.status === 404 && route.negativeTtl)
    const ttl = upstreamResponse.ok ? route.ttl : route.negativeTtl
    const response = new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: {
        "content-type": upstreamResponse.headers.get("content-type") ?? "application/json",
        "cache-control": cacheable ? `public, max-age=${ttl}` : "no-store"
      }
    })
    if (cacheable) ctx.waitUntil(cache.put(cacheKey, response.clone()))
    return response
  }
}
