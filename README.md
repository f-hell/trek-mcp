# trek-mcp

A personal-use [MCP](https://modelcontextprotocol.io) server for planning hiking trips in Norway.
It combines trail, area and cabin data from [ut.no](https://ut.no) with cabin availability from
[hyttebestilling.dnt.no](https://hyttebestilling.dnt.no), so an assistant like Claude can answer
questions such as *"find a 4-night hut-to-hut route in Jotunheimen for 3 people in mid-July, with
beds free every night"*.

*Note: This project is still under development, and fixes and new features will be pushed continuously.*

> **Personal use only.** It runs locally over stdio, is never hosted, and only reads data: it
> links to the booking page, it never books. Requests are rate-limited (1 per second per host by
> default) and cached on disk.

## Status

| Part | State |
| --- | --- |
| MCP server, tools, planning logic, caching and rate limiting | Working, tested |
| ut.no adapter | Working against the live GraphQL API (`https://ut.no/api/graphql`), tested on recorded responses |
| hyttebestilling adapter | Working against the live availability calendar, tested on recorded responses |

## Setup

Needs Node.js 20 or later.

```bash
git clone https://github.com/f-hell/trek-mcp.git
cd trek-mcp
npm install   # also builds dist/
npm test
```

After a `git pull`, run `npm run build` (or `npm install`) and reconnect the server, since it runs
the compiled `dist/`.

### Use with Claude Code

Start `claude` in this folder. The bundled `.mcp.json` registers `trek`; approve it when prompted.
To use the server from other folders:

```bash
claude mcp add trek -- node /absolute/path/to/trek-mcp/dist/index.js
```

### Use with Claude Desktop

```json
{
  "mcpServers": {
    "trek": {
      "command": "node",
      "args": ["/absolute/path/to/trek-mcp/dist/index.js"]
    }
  }
}
```

## Tools

| Tool | What it does |
| --- | --- |
| `search_areas` | Find DNT hiking areas (Jotunheimen, Hardangervidda…); protected and reindeer areas on request |
| `search_cabins` | Cabins by name, area, municipality, service level (betjent/selvbetjent/ubetjent), facilities (fishing, boat, sauna…), suitability or distance from a point; optionally only those open on a date or whose description mentions a keyword. One short row per cabin |
| `get_cabin` | Beds, service level, DNT key, location, booking id |
| `search_trips` / `get_trip` | Suggested hikes with grading, distance, duration, ascent |
| `check_availability` | Nightly free beds for one cabin over a date range |
| `find_signature_routes` | Well-known routes: DNT's SignaTUR long-distance hikes (Høgruta, SAGA, MASSIV …) with days, distance and cabins |
| `get_cabin_routes` | Marked routes out of a cabin, with the cabin at the other end and time/ascent in the direction of travel |
| `find_routes_between_cabins` | Direct marked routes between two cabins, and two-leg options via one cabin |
| `get_route` | One marked route in full: terrain descriptions both ways, winter marking dates |
| `find_hut_trips` | Searches the marked-route network for multi-day trips from a cabin or a car park: loops back to the start, to an end cabin, or one way; skips cabins closed on their night, checks free beds, and flags links only matched by distance |
| `plan_hut_to_hut` | Checks a chain of cabins night by night for a group, reports blocked nights, the marked routes for each leg (summer or winter), and searches a flexible window for start dates that work |

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `UTNO_GRAPHQL_URL` | `https://ut.no/api/graphql` | ut.no GraphQL endpoint |
| `BOOKING_AVAILABILITY_PATH` | `/api/booking/availability-calendar?cabinId={id}&fromDate={from}&toDate={to}` | Availability path template |
| `TREK_MCP_PARSE_BOOKING_PAGES` | unset | `1` also reads notices and booking limits from hyttebestilling's HTML cabin pages (off: JSON APIs only) |
| `TREK_MCP_MIN_INTERVAL_MS` | `1000` | Minimum delay between requests to one host |
| `TREK_MCP_CACHE_DIR` | `~/.cache/trek-mcp` | Response cache |
| `TREK_MCP_CONTACT` | unset | Added to the User-Agent so site operators can reach you |

`data/cabin-map.json` maps ut.no cabin ids to hyttebestilling ids, for cabins where ut.no doesn't expose the booking link.

See [docs/DESIGN.md](docs/DESIGN.md) for architecture and the roadmap.
