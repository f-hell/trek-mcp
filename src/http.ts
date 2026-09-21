import { DiskCache } from "./cache.js";
import { config } from "./config.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    body: string,
  ) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 300)}`);
  }
}

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  /** Cache the parsed response for this long. 0 disables caching. */
  ttlMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Polite JSON HTTP client: identifies itself, serialises requests per host
 * with a minimum interval, retries transient failures, and caches responses
 * on disk so repeated planning sessions don't re-hit the sites.
 */
export class PoliteHttp {
  private readonly nextSlot = new Map<string, number>();

  constructor(
    private readonly cache = new DiskCache(config.cacheDir),
    private readonly minIntervalMs = config.minIntervalMs,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async throttle(host: string): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + this.minIntervalMs);
    if (slot > now) await sleep(slot - now);
  }

  async json<T>(url: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? "GET";
    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const cacheKey = `${method} ${url} ${body ?? ""}`;
    const ttl = opts.ttlMs ?? 0;

    if (ttl > 0) {
      const hit = await this.cache.get<T>(cacheKey);
      if (hit !== undefined) return hit;
    }

    const host = new URL(url).host;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.throttle(host);
      try {
        const res = await this.fetchImpl(url, {
          method,
          body,
          headers: {
            accept: "application/json",
            "user-agent": config.userAgent,
            ...(body ? { "content-type": "application/json" } : {}),
            ...opts.headers,
          },
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new HttpError(res.status, url, await res.text());
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        if (!res.ok) throw new HttpError(res.status, url, await res.text());
        const data = (await res.json()) as T;
        if (ttl > 0) await this.cache.set(cacheKey, data, ttl);
        return data;
      } catch (err) {
        if (err instanceof HttpError) throw err;
        lastErr = err;
        await sleep(1000 * 2 ** attempt);
      }
    }
    throw lastErr;
  }
}
