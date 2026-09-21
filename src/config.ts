import { homedir } from "node:os";
import { join } from "node:path";

const env = process.env;

export const config = {
  userAgent:
    env.TREK_MCP_USER_AGENT ??
    `trek-mcp/0.1 (personal trip planning${env.TREK_MCP_CONTACT ? `; ${env.TREK_MCP_CONTACT}` : ""})`,
  /** Minimum delay between requests to the same host. */
  minIntervalMs: Number(env.TREK_MCP_MIN_INTERVAL_MS ?? 1000),
  cacheDir:
    env.TREK_MCP_CACHE_DIR ??
    join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "trek-mcp"),
  /** Serve bundled fixtures instead of calling the real sites. */
  fixtures: env.TREK_MCP_FIXTURES === "1",
  utno: {
    // UNVERIFIED: confirm with `npm run recon` / `npm run introspect:utno`.
    graphqlUrl: env.UTNO_GRAPHQL_URL ?? "https://api.ut.no/",
    webBaseUrl: "https://ut.no",
    ttlMs: 7 * 24 * 3600_000,
  },
  booking: {
    // UNVERIFIED: the availability endpoint is unknown until recon is done.
    baseUrl: env.BOOKING_BASE_URL ?? "https://hyttebestilling.dnt.no",
    availabilityPath: env.BOOKING_AVAILABILITY_PATH,
    ttlMs: 10 * 60_000,
  },
};
