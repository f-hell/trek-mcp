# trek-mcp

A personal-use [MCP](https://modelcontextprotocol.io) server for planning hiking trips in Norway.
It combines trail, area and cabin data from [ut.no](https://ut.no) with cabin availability from
[hyttebestilling.dnt.no](https://hyttebestilling.dnt.no), so an assistant like Claude can answer
questions such as *"find a 4-night hut-to-hut route in Jotunheimen for 3 people in mid-July, with
beds free every night"*.

> **Personal use only.** It runs locally over stdio, is never hosted, and only reads data: it
> links to the booking page, it never books. Requests are rate-limited (1 per second per host by
> default) and cached on disk.

## Status

| Part | State |
| --- | --- |
| MCP server, tools, planning logic, caching and rate limiting | Working, tested |
| Fixture mode (offline sample data) | Working, so you can try it in Claude now |
| ut.no adapter | Working against the live GraphQL API (`https://ut.no/api/graphql`), tested on recorded responses |
| hyttebestilling adapter | Working against the live availability calendar, tested on recorded responses |

## Setup

```bash
npm install
npm run build
npm test
```

### Use with Claude Code

```bash
claude mcp add trek -- node /absolute/path/to/trek-mcp/dist/index.js
# fixture mode, for trying it out:
claude mcp add trek-demo -e TREK_MCP_FIXTURES=1 -- node /absolute/path/to/trek-mcp/dist/index.js
```

### Use with Claude Desktop

```json
{
  "mcpServers": {
    "trek": {
      "command": "node",
      "args": ["/absolute/path/to/trek-mcp/dist/index.js"],
      "env": { "TREK_MCP_FIXTURES": "1" }
    }
  }
}
```

## Tools

| Tool | What it does |
| --- | --- |
| `search_areas` | Find areas (Jotunheimen, Hardangervidda…) |
| `search_cabins` | Cabins by text, area, service level (betjent/selvbetjent/ubetjent) or distance from a point |
| `get_cabin` | Beds, service level, DNT key, location, booking id |
| `search_trips` / `get_trip` | Suggested hikes with grading, distance, duration, ascent |
| `check_availability` | Nightly free beds for one cabin over a date range |
| `plan_hut_to_hut` | Checks a chain of cabins night by night for a group, reports blocked nights and leg distances, and searches a flexible window for start dates that work |

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TREK_MCP_FIXTURES` | unset | `1` = use bundled sample data, no network |
| `UTNO_GRAPHQL_URL` | `https://ut.no/api/graphql` | ut.no GraphQL endpoint |
| `BOOKING_AVAILABILITY_PATH` | `/api/booking/availability-calendar?cabinId={id}&fromDate={from}&toDate={to}` | Availability path template |
| `TREK_MCP_PARSE_BOOKING_PAGES` | unset | `1` also reads notices and booking limits from hyttebestilling's HTML cabin pages (off: JSON APIs only) |
| `TREK_MCP_MIN_INTERVAL_MS` | `1000` | Minimum delay between requests to one host |
| `TREK_MCP_CACHE_DIR` | `~/.cache/trek-mcp` | Response cache |
| `TREK_MCP_CONTACT` | unset | Added to the User-Agent so site operators can reach you |

`data/cabin-map.json` maps ut.no cabin ids to hyttebestilling ids, for cabins where ut.no doesn't expose the booking link.

See [docs/DESIGN.md](docs/DESIGN.md) for architecture and the roadmap.
