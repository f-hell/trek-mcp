// Records small real responses from ut.no and hyttebestilling into
// test/fixtures/ for the normaliser tests. Makes about ten requests, 1 s apart.
//
//   npm run fixtures:record
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../src/config.js";
import { PoliteHttp } from "../src/http.js";
import * as Q from "../src/sources/utno/queries.js";

const dir = join("test", "fixtures");
// ttlMs: 0 below bypasses the cache, so this records live responses.
const http = new PoliteHttp();

const gql = (query: string, variables: Record<string, unknown>) =>
  http.json<unknown>(config.utno.graphqlUrl, { method: "POST", body: { query, variables }, ttlMs: 0 });

async function save(name: string, value: unknown, trim?: (v: any) => void) {
  trim?.(value);
  await mkdir(join(dir, name, ".."), { recursive: true });
  await writeFile(join(dir, name), JSON.stringify(value, null, 2) + "\n");
  console.log("wrote", name);
}

const sort = [{ field: "name", direction: "ASC" }];

await save("utno/cabin-101265.json", await gql(Q.GET_CABIN, { id: 101265 }));
await save(
  "utno/cabins-gjende.json",
  await gql(Q.FIND_CABINS, { paging: { first: 5 }, filter: { name: { iLike: "%gjende%" } }, sorting: sort }),
);
await save(
  "utno/cabins-near-skarvheim.json",
  await gql(Q.CABINS_NEAR, { input: { coordinates: [8.04158, 61.02224], maxDistance: 15000 } }),
  (v) => (v.data.cabinsNear = v.data.cabinsNear.slice(0, 3)),
);
await save("utno/trip-116978.json", await gql(Q.GET_TRIP, { id: 116978 }));
await save(
  "utno/areas-jotunheimen.json",
  await gql(Q.FIND_AREAS, { paging: { first: 3 }, filter: { name: { iLike: "%jotunheimen%" } }, sorting: sort }),
);

// Keep the requested nights (the rest are zero-filled) and the product fields
// the normaliser reads.
const calendar = async (id: string, from: string, to: string) => {
  const v: any = await http.json<unknown>(
    new URL(
      config.booking.availabilityPath.replace("{id}", id).replace("{from}", from).replace("{to}", to),
      config.booking.baseUrl,
    ).toString(),
    { ttlMs: 0 },
  );
  v.data.availabilityList = v.data.availabilityList.filter((d: any) => d.date.slice(0, 10) >= from && d.date.slice(0, 10) < to);
  for (const p of v.data.products) {
    p.attributes = p.attributes.filter((a: any) => ["persons_max", "is_bed"].includes(a.group?.name));
  }
  return v;
};
await save("booking/calendar-101265-autumn.json", await calendar("101265", "2026-10-12", "2026-10-15"));
await save("booking/calendar-10581-summer.json", await calendar("10581", "2027-07-10", "2027-07-12"));
