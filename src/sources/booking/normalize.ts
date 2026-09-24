import type { NightAvailability } from "../../domain.js";
import { isObj, num, pick, type Raw, str } from "../normalize.js";

// Normalises hyttebestilling's GET /api/booking/availability-calendar response
// (see docs/RECON.md and test/fixtures/booking/):
//
//   { data: {
//       availabilityList: [{ date: "2026-10-01T00:00:00.000Z",
//                            products: [{ available: 1, product: { product_id, unit_id } }] }],
//       products: [{ product_id, unit_id, product_name, unit_name,
//                    attributes: [{ group: { name: "persons_max" }, value: "1" }] }] } }
//
// Self-service cabins list one unit per bed ("Skarvheim, rom 2, seng 1");
// staffed cabins list bed categories ("Seng i 2-sengsrom") with a count, plus
// tent pitches and extra mattresses, which don't count as beds here.
//
// The list spans a window chosen by the site (today or the start of the month
// to the end of a half-year), but only nights in [fromDate, toDate) carry real
// values; the rest are zero-filled. Callers must keep only the nights they asked for.

const NOT_A_BED = /teltplass|ekstramadrass|madrass/i;

interface ProductInfo {
  name: string;
  persons: number;
  isBed: boolean;
}

const key = (p: Raw) => `${str(p, "product_id") ?? ""}:${str(p, "unit_id") ?? ""}`;

function productInfo(products: unknown): Map<string, ProductInfo> {
  const out = new Map<string, ProductInfo>();
  if (!Array.isArray(products)) return out;
  for (const p of products.filter(isObj)) {
    const attrs = Array.isArray(p.attributes) ? p.attributes.filter(isObj) : [];
    const attr = (name: string) => attrs.find((a) => str(a, "group.name") === name);
    const max = attr("persons_max");
    const name = str(p, "unit_name") ?? str(p, "product_name") ?? key(p);
    out.set(key(p), {
      name,
      persons: (max && num(max, "value")) || 1,
      isBed: !NOT_A_BED.test(name),
    });
  }
  return out;
}

/** Self-service units are single beds named "<cabin>, rom 2, seng 1"; group them as "Seng". */
const optionName = (info: ProductInfo | undefined) => (!info ? "Ukjent" : /, seng \d+/i.test(info.name) ? "Seng" : info.name);

/**
 * Total beds sold online, known only when every bed product is an individual
 * unit (self-service: "rom 2, seng 1"). Staffed cabins sell categories with a
 * count (unit_id 0), whose size the payload doesn't give.
 */
function bedCapacity(products: unknown, info: Map<string, ProductInfo>): number | undefined {
  if (!Array.isArray(products)) return undefined;
  const beds = products.filter(isObj).filter((p) => info.get(key(p))?.isBed ?? true);
  if (!beds.length || beds.some((p) => num(p, "unit_id") === 0)) return undefined;
  return beds.reduce((sum, p) => sum + (info.get(key(p))?.persons ?? 1), 0);
}

export function normalizeAvailability(payload: unknown): NightAvailability[] {
  const data = isObj(payload) ? pick(payload, "data") : undefined;
  if (!isObj(data)) return [];
  const list = pick(data, "availabilityList");
  if (!Array.isArray(list)) return [];
  const info = productInfo(pick(data, "products"));
  const bookableBeds = bedCapacity(pick(data, "products"), info);

  return list
    .filter(isObj)
    .flatMap((day): NightAvailability[] => {
      const date = str(day, "date")?.slice(0, 10);
      if (!date) return [];
      let beds = 0;
      const options = new Map<string, number>();
      for (const p of Array.isArray(day.products) ? day.products.filter(isObj) : []) {
        const i = info.get(key(isObj(p.product) ? p.product : {}));
        const places = (num(p, "available") ?? 0) * (i?.persons ?? 1);
        if (!places) continue;
        if (i?.isBed ?? true) beds += places;
        const name = optionName(i);
        options.set(name, (options.get(name) ?? 0) + places);
      }
      const night: NightAvailability = { date, status: beds > 0 ? "available" : "full", bedsAvailable: beds };
      if (bookableBeds !== undefined) night.bookableBeds = bookableBeds;
      if (options.size) night.options = [...options].map(([name, available]) => ({ name, available }));
      return [night];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
