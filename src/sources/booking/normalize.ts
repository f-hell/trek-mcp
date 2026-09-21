import type { NightAvailability, NightStatus } from "../../domain.js";
import { bool, isObj, num, pick, type Raw, str } from "../normalize.js";

// UNVERIFIED: hyttebestilling's availability payload is unknown until recon.
// This accepts a few plausible shapes:
//   [{ date, available|freeBeds|availableBeds, status? }]
//   { days|availability|calendar: [...] }
//   { "2026-07-01": { ... } | number }

function status(raw: Raw, beds: number | undefined): NightStatus {
  const s = (str(raw, "status", "state") ?? "").toLowerCase();
  if (["closed", "stengt", "unavailable"].includes(s)) return "closed";
  if (["full", "fullt", "soldout", "booked"].includes(s)) return "full";
  if (["available", "ledig", "open"].includes(s)) return "available";
  const open = bool(raw, "isOpen", "open");
  if (open === false) return "closed";
  if (beds !== undefined) return beds > 0 ? "available" : "full";
  const avail = bool(raw, "available", "isAvailable");
  if (avail !== undefined) return avail ? "available" : "full";
  return "unknown";
}

function night(date: string, v: unknown): NightAvailability | undefined {
  if (typeof v === "number") return { date, status: v > 0 ? "available" : "full", bedsAvailable: v };
  if (!isObj(v)) return undefined;
  const beds = num(v, "bedsAvailable", "availableBeds", "freeBeds", "available", "vacancies", "capacityLeft");
  return { date, status: status(v, beds), bedsAvailable: beds };
}

export function normalizeAvailability(payload: unknown): NightAvailability[] {
  let list: unknown = payload;
  if (isObj(payload)) {
    list = pick(payload, "days", "availability", "calendar", "nights", "data") ?? payload;
  }
  const out: NightAvailability[] = [];
  if (Array.isArray(list)) {
    for (const item of list) {
      if (!isObj(item)) continue;
      const date = str(item, "date", "day", "night")?.slice(0, 10);
      const n = date && night(date, item);
      if (n) out.push(n);
    }
  } else if (isObj(list)) {
    for (const [k, v] of Object.entries(list)) {
      if (!/^\d{4}-\d{2}-\d{2}/.test(k)) continue;
      const n = night(k.slice(0, 10), v);
      if (n) out.push(n);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
