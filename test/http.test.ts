import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DiskCache } from "../src/cache.js";
import { HttpError, PoliteHttp } from "../src/http.js";

const cache = () => new DiskCache(mkdtempSync(join(tmpdir(), "trek-mcp-")));

describe("PoliteHttp", () => {
  it("caches responses and spaces out requests per host", async () => {
    const times: number[] = [];
    const fake = (async (url: string) => {
      times.push(Date.now());
      return new Response(JSON.stringify({ url }), { status: 200 });
    }) as unknown as typeof fetch;
    const http = new PoliteHttp(cache(), 100, fake);

    await http.json("https://x.test/a", { ttlMs: 60_000 });
    await http.json("https://x.test/a", { ttlMs: 60_000 }); // cached
    await http.json("https://x.test/b");
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(95);
  });

  it("does not retry client errors", async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    await expect(new PoliteHttp(cache(), 0, fake).json("https://x.test/")).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(1);
  });
});
