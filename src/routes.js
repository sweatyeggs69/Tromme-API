// One entry per proxied endpoint. Add a service by adding an entry here and its secret in wrangler.
// Routes with `secret` need that key (added as `keyParam`); `originSecret` is sent as X-Origin-Secret when set.
// A param with `inPath: true` fills the `{name}` placeholder in `upstream` instead of the query, and
// `pattern` restricts its value. `requireOne` needs at least one of the listed params.
// `negativeTtl` also caches 404s (a confirmed "nothing there"). Only the listed query params are forwarded; everything else the client sends is dropped.
const MAX_PARAM_LENGTH = 200

export const routes = {
  "/lastfm/top-tracks": {
    upstream: "https://ws.audioscrobbler.com/2.0/",
    secret: "LASTFM_API_KEY",
    keyParam: "api_key",
    params: { artist: { required: true } },
    fixed: { method: "artist.gettoptracks", format: "json", limit: "10", autocorrect: "1" },
    ttl: 21600
  },
  "/ticketmaster/events": {
    upstream: "https://app.ticketmaster.com/discovery/v2/events.json",
    secret: "TICKETMASTER_API_KEY",
    keyParam: "apikey",
    params: { keyword: { required: true } },
    fixed: { classificationName: "music", sort: "date,asc", size: "50", locale: "*" },
    ttl: 3600
  },
  // AppleArt behind a Cloudflare tunnel. The origin secret is optional until AppleArt enforces ORIGIN_SECRET.
  "/artwork/search": {
    upstream: "https://amaa.tromme.app/api/v1/artwork/search",
    originSecret: "ARTWORK_ORIGIN_SECRET",
    params: { artist: { required: true }, album: { required: true } },
    fixed: {},
    ttl: 3600
  },
  // Lyrics sources. Responses pass through unchanged; the app does the matching.
  "/lyrics/lrclib/search": {
    upstream: "https://lrclib.net/api/search",
    params: { track_name: {}, artist_name: {}, q: {} },
    requireOne: true,
    fixed: {},
    ttl: 3600,
    negativeTtl: 3600
  },
  "/lyrics/lrcred/search": {
    upstream: "https://lrc.red/search.json",
    params: { q: { required: true } },
    fixed: {},
    ttl: 3600,
    negativeTtl: 3600
  },
  "/lyrics/lrcred/lrc": {
    upstream: "https://lrc.red/s/{isrc}.lrc",
    params: { isrc: { required: true, inPath: true, pattern: /^[A-Za-z0-9]{12}$/ } },
    fixed: {},
    ttl: 21600,
    negativeTtl: 3600
  }
}

export { MAX_PARAM_LENGTH }
