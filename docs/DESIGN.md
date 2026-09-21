# Design

## Goals

- Plan multi-day hikes in Norway conversationally: areas → trips → cabins → availability → itinerary.
- Personal use: local stdio server, read-only, gentle on both sites.
- Keep each site's wire format isolated, so API changes on their side mean editing one adapter.

## Architecture

```
MCP client (Claude)
      │ stdio
src/index.ts ── src/tools.ts          tool schemas (zod) + JSON results
                    │
               src/service.ts          combines sources, cabin id mapping
               ├── src/planning/       pure itinerary logic (no I/O, fully tested)
               └── src/sources/
                   ├── types.ts        TrailSource / BookingSource interfaces
                   ├── utno/           ut.no GraphQL → domain types
                   ├── booking/        hyttebestilling → NightAvailability
                   └── fixtures.ts     offline stand-ins (TREK_MCP_FIXTURES=1)
               src/http.ts             UA, per-host throttle, retries, disk cache
               src/domain.ts           Cabin, Trip, Area, NightAvailability
```

Each adapter's normaliser (`src/sources/*/normalize.ts`) is the only code that knows a site's field
names. It accepts several plausible spellings for now; after recon we narrow it to the real ones
and add recorded responses as test fixtures.

## Linking the two sources

A cabin's ut.no id and its hyttebestilling id are different (hyttebestilling URLs look like
`/hytte/101265`). Resolution order:

1. A `bookingId`/`bookingUrl` field in the ut.no cabin data (to confirm during recon).
2. `data/cabin-map.json` overrides.
3. Later, if needed: match by name plus distance against a hyttebestilling cabin list.

## Caching and politeness

| Data | TTL |
| --- | --- |
| ut.no cabins, trips, areas | 7 days |
| Availability | 10 minutes |

Requests to one host are at least 1 s apart, with retries and backoff on 429 and 5xx responses.
`plan_hut_to_hut` makes one availability request per cabin covering the whole flexible window,
rather than one per candidate date.

## Planning semantics

A trip is an ordered list of `{ cabin, nights }`. Each night gets a verdict:

- `ok`: confirmed free beds ≥ guests
- `likely`: marked available but no bed count
- `insufficient` / `full` / `closed`: blocks the trip
- `not-bookable`: the cabin isn't on hyttebestilling (e.g. ubetjent, first come, first served). Doesn't block.
- `unknown`: no data for that night. Doesn't block, but is counted as uncertain.

Legs report straight-line distance for now. Real trail distance comes from matching ut.no trips
or routes whose endpoints are the two cabins (roadmap).

## Roadmap

1. **Recon** ([RECON.md](RECON.md)): capture real ut.no queries and the hyttebestilling availability endpoint.
2. Fix `queries.ts` and both normalisers, then add the recorded responses as fixtures and tests.
3. Resolve booking ids automatically (step 1 or 3 above).
4. `find_route_between_cabins`: ut.no routes/trips connecting two cabins, with real distance, time and ascent.
5. `suggest_hut_to_hut`: given an area, number of nights and grading, propose cabin chains from the trip graph, then check availability.
6. Season awareness: opening periods, "hytteslipp" (the date bookings open for next season), and summer vs. winter beds.
7. Optional extras: weather (MET Norway / yr.no API, which allows open use with a User-Agent) and public transport to trailheads (Entur).

## Open questions

- Does ut.no's API allow introspection? If so, `npm run introspect:utno` gives us the whole schema.
- Does hyttebestilling's availability endpoint need a session cookie or token, or is it public?
- Does hyttebestilling report free beds per night, or only available/full?
- Are self-service/no-service cabins with pre-bookable beds listed on hyttebestilling separately from their drop-in beds?
