import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface Entry<T> {
  expires: number;
  value: T;
}

/** Tiny disk-backed TTL cache. One JSON file per key. */
export class DiskCache {
  constructor(private readonly dir: string) {}

  private path(key: string): string {
    return join(this.dir, createHash("sha256").update(key).digest("hex") + ".json");
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const entry = JSON.parse(await readFile(this.path(key), "utf8")) as Entry<T>;
      return entry.expires > Date.now() ? entry.value : undefined;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const entry: Entry<T> = { expires: Date.now() + ttlMs, value };
    await writeFile(this.path(key), JSON.stringify(entry));
  }
}
