// Records the JSON/GraphQL requests a site's frontend makes while you click
// around, so we can find the real API endpoints and payloads.
//
//   npx playwright install chromium   # once
//   npm run recon -- https://ut.no/hytte/<id> https://hyttebestilling.dnt.no/hytte/101265
//
// A browser window opens. Browse normally: search, open cabins and trips,
// pick dates in the booking calendar. Press Enter in the terminal (or close
// the browser) to finish. Output: recon/recon-<timestamp>.json
//
// Review the output before sharing it: it may contain cookies or personal
// data if you log in. Logging in is not needed for availability.

import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { chromium, type Request } from "playwright";

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error("usage: npm run recon -- <url> [url...]");
  process.exit(1);
}

const IGNORE = /google|gtm|analytics|hotjar|sentry|facebook|doubleclick|cookiebot|consent|segment|mapbox.*tiles|\.(png|jpg|jpeg|webp|svg|woff2?|css)(\?|$)/i;
const MAX_BODY = 20_000;

interface Captured {
  method: string;
  url: string;
  resourceType: string;
  requestHeaders: Record<string, string>;
  postData?: unknown;
  status?: number;
  contentType?: string;
  responseBody?: unknown;
}

const captured: Captured[] = [];
const parse = (s: string | null | undefined) => {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s.slice(0, MAX_BODY);
  }
};

async function record(req: Request) {
  if (!["fetch", "xhr"].includes(req.resourceType()) || IGNORE.test(req.url())) return;
  const headers = { ...req.headers() };
  delete headers.cookie;
  delete headers.authorization;
  const entry: Captured = {
    method: req.method(),
    url: req.url(),
    resourceType: req.resourceType(),
    requestHeaders: headers,
    postData: parse(req.postData()),
  };
  captured.push(entry);
  const res = await req.response().catch(() => null);
  if (!res) return;
  entry.status = res.status();
  entry.contentType = res.headers()["content-type"];
  if (entry.contentType?.includes("json")) {
    const text = await res.text().catch(() => "");
    entry.responseBody = text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}…[truncated]` : parse(text);
  }
  console.log(`${entry.status} ${entry.method} ${entry.url.slice(0, 140)}`);
}

const browser = await chromium.launch({ headless: false });
const page = await (await browser.newContext()).newPage();
page.on("request", (r) => void record(r));
for (const u of urls) await page.goto(u, { waitUntil: "domcontentloaded" }).catch((e) => console.error(String(e)));

console.log("\nBrowse around, then press Enter here to save.\n");
await Promise.race([
  new Promise<void>((r) => createInterface({ input: process.stdin }).once("line", () => r())),
  new Promise<void>((r) => browser.on("disconnected", () => r())),
]);

await mkdir("recon", { recursive: true });
const file = `recon/recon-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
await writeFile(file, JSON.stringify(captured, null, 2));
console.log(`Saved ${captured.length} requests to ${file}`);
await browser.close().catch(() => {});
