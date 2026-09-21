# Recon: finding the real endpoints

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
