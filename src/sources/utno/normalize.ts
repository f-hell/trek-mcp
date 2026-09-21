import type { Area, Cabin, Grading, ServiceLevel, Trip } from "../../domain.js";
import { bool, isObj, latLon, num, pick, type Raw, str } from "../normalize.js";

const WEB = "https://ut.no";

export function serviceLevel(v: string | undefined): ServiceLevel {
  const s = (v ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (["staffed", "betjent", "fullservice"].includes(s)) return "staffed";
  if (["selfservice", "selvbetjent"].includes(s)) return "self-service";
  if (["noservice", "ubetjent", "noserviceextended"].includes(s)) return "no-service";
  if (["emergency", "emergencyshelter", "nødbu", "nodbu"].includes(s)) return "emergency";
  if (["closed", "stengt"].includes(s)) return "closed";
  return "unknown";
}

export function grading(v: string | undefined): Grading {
  const s = (v ?? "").toLowerCase();
  if (["easy", "enkel", "green", "grønn"].includes(s)) return "easy";
  if (["moderate", "middels", "blue", "blå"].includes(s)) return "moderate";
  if (["tough", "krevende", "red", "rød"].includes(s)) return "tough";
  if (["verytough", "very_tough", "expert", "ekspert", "black", "svart"].includes(s)) return "expert";
  return "unknown";
}

function firstArea(raw: Raw): { id: string; name: string } | undefined {
  const areas = pick(raw, "areas", "area");
  const a = Array.isArray(areas) ? areas[0] : areas;
  if (!isObj(a)) return undefined;
  const id = str(a, "id");
  const name = str(a, "name");
  return id && name ? { id, name } : undefined;
}

/** Extracts a hyttebestilling id from a booking URL like https://hyttebestilling.dnt.no/hytte/101265 */
export function bookingIdFromUrl(url: string | undefined): string | undefined {
  return url?.match(/hyttebestilling\.dnt\.no\/hytte\/(\d+)/)?.[1];
}

export function normalizeCabin(raw: Raw): Cabin {
  const id = str(raw, "id") ?? "";
  const loc = latLon(pick(raw, "geometry", "location", "position"));
  return {
    id,
    name: str(raw, "name") ?? `Cabin ${id}`,
    serviceLevel: serviceLevel(str(raw, "serviceLevel", "serviceLevelToday", "type")),
    dntCabin: bool(raw, "dntCabin", "isDntCabin") ?? false,
    requiresDntKey: bool(raw, "dntKey", "requiresKey"),
    beds: {
      total: num(raw, "bedsToday", "beds", "bedsTotal"),
      staffed: num(raw, "bedsStaffed"),
      selfService: num(raw, "bedsSelfService"),
      noService: num(raw, "bedsNoService"),
      winter: num(raw, "bedsWinter"),
    },
    location: loc ? { ...loc, elevationM: num(raw, "elevation", "altitude") } : undefined,
    area: firstArea(raw),
    description: str(raw, "description", "descriptionPlain"),
    url: str(raw, "url") ?? `${WEB}/hytte/${id}`,
    bookingId: str(raw, "bookingId") ?? bookingIdFromUrl(str(raw, "bookingUrl")),
  };
}

export function normalizeTrip(raw: Raw): Trip {
  const id = str(raw, "id") ?? "";
  const distanceM = num(raw, "distance", "distanceMeters");
  const minutes = num(raw, "durationMinutes");
  const cabins = pick(raw, "cabins");
  return {
    id,
    name: str(raw, "name") ?? `Trip ${id}`,
    grading: grading(str(raw, "grading", "difficulty")),
    distanceKm: distanceM !== undefined ? Math.round(distanceM / 100) / 10 : undefined,
    durationHours: minutes !== undefined ? Math.round((minutes / 60) * 10) / 10 : num(raw, "durationHours"),
    ascentM: num(raw, "elevationGain", "ascent"),
    descentM: num(raw, "elevationLoss", "descent"),
    start: latLon(pick(raw, "startPoint", "start")),
    end: latLon(pick(raw, "endPoint", "end")),
    area: firstArea(raw),
    cabinIds: Array.isArray(cabins) ? cabins.filter(isObj).map((c) => str(c, "id")).filter((x): x is string => !!x) : undefined,
    description: str(raw, "description", "descriptionPlain"),
    url: str(raw, "url") ?? `${WEB}/tur/${id}`,
  };
}

export function normalizeArea(raw: Raw): Area {
  const id = str(raw, "id") ?? "";
  return { id, name: str(raw, "name") ?? `Area ${id}`, description: str(raw, "description"), url: str(raw, "url") ?? `${WEB}/omrade/${id}` };
}

/** Unwraps relay-style `{ totalCount, edges: [{ node }] }` or plain arrays. */
export function unwrapList(v: unknown): { nodes: Raw[]; total?: number } {
  if (Array.isArray(v)) return { nodes: v.filter(isObj) };
  if (!isObj(v)) return { nodes: [] };
  const edges = pick(v, "edges", "items", "nodes", "results");
  const nodes = Array.isArray(edges) ? edges.map((e) => (isObj(e) && isObj(e.node) ? e.node : e)).filter(isObj) : [];
  return { nodes, total: num(v, "totalCount", "total") };
}
