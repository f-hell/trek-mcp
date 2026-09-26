# Recon: finding the real endpoints

## Findings (probed 2026-09-30)

Both sites were reachable this time. Everything below was confirmed with a handful of anonymous requests,
spaced about 1 s apart, using the trek-mcp User-Agent. Trimmed real responses are in `test/fixtures/{utno,booking}/`.

### ut.no: GraphQL at `https://ut.no/api/graphql`

- The browser's Apollo client posts to **`https://ut.no/api/graphql`**, a same-origin Next.js proxy.
  It works anonymously with a plain JSON POST: no cookie, key or special headers.
- `https://api.ut.no/v1/graphql` is the backend behind it. **Introspection works there** (`UTNO_GRAPHQL_URL=https://api.ut.no/v1/graphql npm run introspect:utno`
  writes `recon/utno-schema.json`), but every data query there returns `FORBIDDEN`. So introspect against api.ut.no
  and query through ut.no/api/graphql.
- The schema is NestJS "nestjs-query" style, with no `ntb_` prefix. Root fields we need:

  | Need | Field | Args |
  |---|---|---|
  | one cabin | `cabin(id: Int!)` | |
  | cabin list / filter | `cabins(paging, filter, sorting)` | `paging:{first, after}`, `filter:{name:{iLike:"%x%"}, serviceLevel, dntCabin, areas:{id:{eq}}, and/or}`, `sorting:[]` → `{totalCount pageInfo edges{node}}` |
  | proximity | `cabinsNear(input:{coordinates:[lon,lat], maxDistance: metres})` | → `[{distance, cabin}]`, sorted by distance |
  | trips | `trip(id)`, `trips(...)`, `tripsNear(...)` | same pattern |
  | routes (marked paths) | `route(id)`, `routes(...)`, `routesNear(...)` | same pattern |
  | areas | `area(id)`, `areas(...)` | filter by `name`, `areaType` (`DNT_AREA`, `PROTECTED_AREA`, …) |
  | free-text search (not used yet) | `search(input:{searchString})` | → `{prioritizedResult, result}` as **strings** `"<type>;<id>;<lon>,<lat>;<name>;<extra…>"` (`d`=cabin, `g`=trip, `e`=place/POI, `i`=list) |

- **Cabin** fields worth using: `id name serviceLevel dntCabin geojson{coordinates[lon,lat,elev]} elevationCustom
  bedsStaffed bedsSelfService bedsNoService bedsWinter bedsExtra bookingEnabled bookingOnly bookingUrl idVisbook
  serviceStatus{serviceLevel from to beds openAllYear key} serviceStatusToday areas{id name} tripIds routeIds
  facilities{name} summertimeText wintertimeText links{type url}`.
  `serviceLevel` enum: STAFFED, SELF_SERVICE, NO_SERVICE, NO_SERVICE_NO_BEDS, FOOD_SERVICE, EMERGENCY_SHELTER, CLOSED, RENTAL, UNKNOWN.
- **Trip** fields: `id name grading(EASY…VERY_TOUGH) distance(m) durationDays/Hours/Minutes elevationGain elevationLoss
  elevationMax season[months] direction primaryActivityType startPointGeojson geojson encodedPolyline cabinIds areaIds`.
- `https://ut.no/hytte/<id>` pages are server-rendered with the cabin in `__NEXT_DATA__.props.pageProps.publicCabinData`
  (no geometry). That's a fallback only; GraphQL is better.
- robots.txt disallows `/_next/`, `/*/kart/`, `/*/gpx/`. Don't fetch those at runtime.

### hyttebestilling.dnt.no: plain JSON routes, no auth

Next.js app on Supabase/Visbook. Three GET routes found in its JS, all anonymous:

- **`/api/booking/availability-calendar?cabinId=<id>&fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD`**: per-night availability (used by the adapter).
  `data.availabilityList[] = {date, products:[{available, product:{company_id, product_id, unit_id}}]}` and
  `data.products[]` (`product_name`/`unit_name` plus attributes such as `dropin_beds`, `is_bed`, `persons_max`).
  - Only nights in **[fromDate, toDate)** carry real values; the rest of the list is zero-filled. The list covers a
    site-chosen window (from today or the start of the month to 31 Dec or 30 Jun), so long ranges need several requests.
  - Self-service cabins list one unit per bed ("Skarvheim, rom 2, seng 1"). Staffed cabins list categories with counts
    ("Seng i 2-sengsrom": 22, "Seng i sovesal", "Seng i lavvo", "Teltplass": 81, "Ekstramadrass": 85).
    Free beds = sum of `available` × `persons_max`, **excluding tent pitches and extra mattresses**.
  - Summer 2027 was already bookable when probed on 2026-09-30.
- `/api/booking/cabin-availability?cabinId=&fromDate=&toDate=`: used on the booking step. Returns `availability` (array of numbers,
  one per product?) plus `priceGroups` (prices by age/membership). Large (~85 kB); the shape still needs interpreting.
- `/api/booking/available-price?cabinId=&fromDate=&toDate=&numberOfGuests=`: price quote. Not tried.
- **Cabin page `/hytte/<id>`** (HTML, no robots.txt on the site): the Next.js RSC stream (`self.__next_f.push([1,"…"])`)
  embeds the cabin as JSON: `{ut_id, title, status_message, suitable_for_dogs, service_status_all, content (same description
  as ut.no), web_bookings: {closed_from, closed_to, min_length_of_stay, max_length_of_stay, days_before_cancellation, agreements}}`.
  Other `status_message` values in the stream are site-wide banners (e.g. "Status hytteslipp for overnatting 2026: …").
  Parsed by `src/sources/booking/page.ts`; only the parsed fields are cached (6 h).
- The calendar's `products[].attributes` with `group.name = "description_short"` hold booking conditions and inclusions
  ("Minst en i turfølge må være medlem … DNT-nøkkelen", meal times, room sharing when full).
- Bookings go through Next server actions (`visbookAction`, `addReservationToSupabase`). **Never call those.**

### Linking ut.no to hyttebestilling

- Cabins that aren't on hyttebestilling can still have a `bookingUrl` to their own site (Memurubu → memurubu.no,
  with `bookingOnly: true`). The adapter exposes it so the tools don't claim "first come, first served".
- The hyttebestilling `cabinId` is the number in the ut.no cabin's **`bookingUrl`** (`https://hyttebestilling.dnt.no/hytte/<id>`).
  It's usually the same as the ut.no id, but not always: ut.no 10908403 "Gjendebu Selvbetjent" books via `/hytte/10581`.
  Parse `bookingUrl` and don't assume the ids match. `bookingUrl` may also point elsewhere (e.g. inatur.no for rentals).
- `idVisbook` is Visbook's internal id; the public routes don't need it.

### Sample ids

Skarvheim 101265 (self-service, 9 beds, 6 bookable) · Gjendebu 10581 · Gjendesheim 10604 · Memurubu 10732 ·
Skarvheimen area 1232 · Jotunheimen nasjonalpark 12255 · trip "Høgeloft" 116978.

---

## Original recon instructions (still useful if the sites change)

The adapters were written without access to either site, so the exact API calls need to be
captured once from a normal browser session on your machine.

## 1. Try GraphQL introspection (ut.no)

```bash
npm run introspect:utno
```

If it prints a list of root query fields, send me `recon/utno-schema.json`, or just the field list
plus the `Cabin`/`Trip` types, and I'll rewrite `src/sources/utno/queries.ts` against it.
If it fails, move on to step 2.

## 2. Record the frontend's requests

```bash
npx playwright install chromium   # once
npm run recon -- https://ut.no https://hyttebestilling.dnt.no/hytte/101265
```

A browser window opens. Then:

**On ut.no:** search for a cabin, open a cabin page, open a trip ("tur") page, open an area page,
and pan the map a little.

**On hyttebestilling:** open a cabin, change the dates in the calendar, change the number of
guests, and use the search or map view with a date range.

Press Enter in the terminal. Requests are saved to `recon/recon-<timestamp>.json`. Cookie and
authorization headers are stripped. `recon/` is gitignored.

## 3. What to send back

For each interesting request: the method, URL, request body (GraphQL query and variables) and a
sample response. Look for:

- ut.no: the GraphQL endpoint URL and the operations used for cabin, trip, area and search pages
- ut.no: whether cabin data includes a hyttebestilling link or id
- hyttebestilling: the request that fires when you change dates, i.e. the availability call
- hyttebestilling: whether it needs a cookie or token, which you'd notice if replaying it with `curl` fails

Then set `BOOKING_AVAILABILITY_PATH` (or I'll hard-code it), and I'll update the normalisers and
turn the samples into test fixtures.
