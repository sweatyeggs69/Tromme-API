# Tromme API

| Route | Upstream | Params |
| --- | --- | --- |
| `GET /lastfm/top-tracks` | Last.fm `artist.gettoptracks` | `artist` |
| `GET /ticketmaster/events` | Ticketmaster Discovery events | `keyword` |
| `GET /artwork/search` | AppleArt (`amaa.tromme.app`, via tunnel) | `artist`, `album` |

Only GET, only the listed params; everything else is fixed server-side. Responses are edge cached and rate limited per IP.

## Add a service

Add an entry to `src/routes.js`, then `npx wrangler secret put <SECRET_NAME>`.

## Deploy

```
npm install
npx wrangler secret put LASTFM_API_KEY
npx wrangler secret put TICKETMASTER_API_KEY
npx wrangler deploy
```

Optional: `npx wrangler secret put ARTWORK_ORIGIN_SECRET` (same value as AppleArt's `ORIGIN_SECRET`).
