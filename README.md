# Tromme API

| Route | Upstream | Params |
| --- | --- | --- |
| `GET /lastfm/top-tracks` | Last.fm `artist.gettoptracks` | `artist` |
| `GET /lastfm/album-tags` | Last.fm `album.gettoptags` | `artist`, `album` |
| `GET /lastfm/artist-tags` | Last.fm `artist.gettoptags` | `artist` |
| `GET /ticketmaster/events` | Ticketmaster Discovery events | `keyword` |
| `GET /artwork/search` | AppleArt (`amaa.tromme.app`, via tunnel) | `artist`, `album` |
| `GET /artwork/static` | AppleArt static covers (`amaa.tromme.app`, via tunnel) | `artist`, `album` |
| `GET /artwork/artist` | AppleArt artist images (`amaa.tromme.app`, via tunnel) | `artist` |
| `GET /album/details` | AppleArt album info and track list | `id`, `country` (optional) |

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

Requests sent with `x-tromme-bulk: 1` (library cleanup, new-album automation) also draw from a global per-lane budget kept in the `BulkBudget` Durable Object: 60 uncached AppleArt lookups and 120 uncached Last.fm calls a minute across all clients. When a lane is empty the Worker answers 429 with `retry-after`.
