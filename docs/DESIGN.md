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
names. Both are written against the real responses recorded in `test/fixtures/`
(`npm run fixtures:record` refreshes them).

## Linking the two sources

A cabin's hyttebestilling id is usually its ut.no id, but not always (ut.no 10908403 "Gjendebu Selvbetjent"
books as `/hytte/10581`). Resolution order:

1. The id in the ut.no cabin's `bookingUrl` (`https://hyttebestilling.dnt.no/hytte/<id>`). Confirmed; covers the DNT cabins.
2. `data/cabin-map.json` overrides.
3. If still needed: match by name plus distance against a hyttebestilling cabin list.

Cabins booked elsewhere keep their `bookingUrl` (e.g. memurubu.no), and nights in a period ut.no lists as closed
(`serviceStatus`) are marked closed, since the booking calendar only reports them as 0 beds.

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

1. ~~Recon~~ ([RECON.md](RECON.md)), ~~real queries and normalisers with recorded fixtures~~, ~~booking ids from `bookingUrl`~~ (done 2026-09-30).
2. Use ut.no `search` for fuzzier cabin/trip lookup (it matches "Memurubu" in trip names too).
3. Use `routes`/`routesNear` (marked paths) for real leg distances instead of straight lines.
4. `find_route_between_cabins`: ut.no routes/trips connecting two cabins, with real distance, time and ascent.
5. `suggest_hut_to_hut`: given an area, number of nights and grading, propose cabin chains from the trip graph, then check availability.
6. Season awareness: opening periods, "hytteslipp" (the date bookings open for next season), and summer vs. winter beds.
7. Optional extras: weather (MET Norway / yr.no API, which allows open use with a User-Agent) and public transport to trailheads (Entur).

## Open questions

- Self-service cabins have more beds than they sell online (Skarvheim: 9 beds, 6 bookable; `dropin_beds` attribute).
  Should the planner count the drop-in beds too?
- How does the calendar show a season that hasn't opened for booking yet? (Summer 2027 was already open, so this wasn't seen.)
- `/api/booking/cabin-availability` returns prices by age and membership; could feed a cost estimate.
