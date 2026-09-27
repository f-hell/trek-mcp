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

## Drop-in beds

Almost all DNT cabins take drop-in guests. Some beds can't be pre-booked and go first come, first served, and a
pre-booked bed must generally be claimed by 19:00, after which it goes to drop-in guests. A late arrival keeps a
paid stay but loses the right to that particular bed. (`DNT_BED_RULES` in `src/planning/itinerary.ts`.)

These are kept as general guidance, not hardcoded per cabin: some cabins (staffed ones especially) work differently,
and those post their own notices. Don't add per-cabin deadlines to the code. Instead the cabin's own ut.no text is passed
through: `description` as plain text (e.g. Skarvheim's says "senger tilgjengelig for bestilling: 6, for drop-in: 3" and
"Møt opp før kl. 19.00"), `bookingNotes` (the description's lines about booking, drop-in, arrival and beds, returned with
availability and plans), and `access` (summer/winter travel: boats, buses, parking, marked trails).

## Cross-checking ut.no and hyttebestilling

- Closed periods: ut.no `serviceStatus` marks a night closed, unless hyttebestilling still sells beds that night. Then
  the booking data is kept and the night gets a `note` about the disagreement (a plan warning).
- The calendar's product descriptions add `bookingConditions` (membership and DNT key, meals, room sharing).
- **Off by default:** hyttebestilling's cabin page (HTML, parsed by `booking/page.ts`) adds `statusMessage` (a plan warning),
  `siteNotices`, a `bookingClosed` period (a warning), `min/maxNights` (a stop outside them is a plan problem),
  `cancellationDaysBefore` and `dogsAllowed`. The server stays on the JSON APIs for now; `TREK_MCP_PARSE_BOOKING_PAGES=1`
  switches this on. The code and its tests are kept.
- Plans return `cabinNotes` per cabin with both sources side by side (`utno`, `hyttebestilling`) and `siteNotices`.

- `bookableBeds`: beds sold online, known when the calendar lists single beds (self-service; Skarvheim 6).
- `dropInBeds` = the season's beds from ut.no `serviceStatus` minus `bookableBeds` (Skarvheim 9 − 6 = 3).
  Unknown for staffed cabins, which sell bed categories without a total.
- Planner verdict `drop-in`: too few bookable beds but enough first-come beds. It's a warning, not a problem.
  `book-elsewhere` (own booking site) and `first-come` (no online booking) are warnings too.

Cabins booked elsewhere keep their `bookingUrl` (e.g. memurubu.no), and nights in a period ut.no lists as closed
(`serviceStatus`) are marked closed, since the booking calendar only reports them as 0 beds.

## Route planning

- Well-known routes first: `find_signature_routes` (DNT SignaTUR), then `get_trip` for their day stages.
- The marked-route network: `get_cabin_routes` walks it one cabin at a time; `find_routes_between_cabins` gives direct
  routes and two-leg options via one cabin. Plan legs carry the direct marked routes, foot in June–October and ski
  otherwise when both exist, and a warning when there's no direct route.
- Direction: names decide (`startsAtEnd` in `src/planning/routes.ts`); geometry is a fallback. The cabin at a route's far
  end is matched by the route's place name first, then by the cabin listing the route, then by distance.

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
3. ~~Marked routes between cabins and well-known (SignaTUR) routes~~ (done). Next: chains longer than one intermediate
   cabin, i.e. `suggest_hut_to_hut` over the route graph for N nights and a grading.
4. **Discovery:** cabins worth visiting later, e.g. neighbours along the route network, cabins on SignaTUR routes near a
   trip, or cabins in the same area the user hasn't planned yet.
5. **Terrain insights:** "lots of small lakes here, probably good trout fishing". Start from ut.no POIs (`poisNear`,
   types fishing, lookout point, bathing spot, fording place, bridge); lakes from open map data (Kartverket/N50 or OSM)
   if needed, kept API-based.
6. **Weather:** MET Norway's Locationforecast API (open use with an identifying User-Agent) per cabin and leg, and
   avalanche warnings (Varsom) for winter routes.
4. `find_route_between_cabins`: ut.no routes/trips connecting two cabins, with real distance, time and ascent.
5. `suggest_hut_to_hut`: given an area, number of nights and grading, propose cabin chains from the trip graph, then check availability.
6. Season awareness: opening periods, "hytteslipp" (the date bookings open for next season), and summer vs. winter beds.
7. Optional extras: weather (MET Norway / yr.no API, which allows open use with a User-Agent) and public transport to trailheads (Entur).

## Open questions

- How does the calendar show a season that hasn't opened for booking yet? (Summer 2027 was already open, so this wasn't seen.)
- `/api/booking/cabin-availability` returns prices by age and membership; could feed a cost estimate.
