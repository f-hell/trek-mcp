import type { Area, AreaType, Cabin, CabinOpening, Grading, LatLon, Route, RouteDirection, ServiceLevel, Trip } from "../../domain.js";
import { bool, htmlToText, isObj, latLon, num, pick, type Raw, str } from "../normalize.js";

// Field names verified against ut.no's GraphQL schema (see docs/RECON.md and
// test/fixtures/utno/).

const WEB = "https://ut.no";

/** Maps CabinServiceLevelEnum (STAFFED, SELF_SERVICE, ...) and Norwegian names. */
export function serviceLevel(v: string | undefined): ServiceLevel {
  const s = (v ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (["staffed", "betjent", "fullservice"].includes(s)) return "staffed";
  if (["selfservice", "selvbetjent"].includes(s)) return "self-service";
  if (["noservice", "noservicenobeds", "ubetjent"].includes(s)) return "no-service";
  if (["emergency", "emergencyshelter", "nødbu", "nodbu"].includes(s)) return "emergency";
  if (["closed", "stengt"].includes(s)) return "closed";
  // FOOD_SERVICE, RENTAL, UNKNOWN
  return "unknown";
}

/** Maps GradingEnum (HIGHLY_ACCESSIBLE, EASY, MODERATE, TOUGH, VERY_TOUGH) and Norwegian names. */
export function grading(v: string | undefined): Grading {
  const s = (v ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (["highlyaccessible", "easy", "enkel", "green", "grønn"].includes(s)) return "easy";
  if (["moderate", "middels", "blue", "blå"].includes(s)) return "moderate";
  if (["tough", "krevende", "red", "rød"].includes(s)) return "tough";
  if (["verytough", "expert", "ekspert", "black", "svart"].includes(s)) return "expert";
  return "unknown";
}

/** ut.no's cabin facility ids (CabinFacility), as stable English keys. */
export const FACILITIES: Record<number, string> = {
  1: "prebooking", 2: "water", 3: "mobile-coverage", 4: "tent-pitch", 5: "bike-rental", 6: "rental",
  7: "local-food", 8: "oven", 9: "shower", 10: "card-payment", 11: "meals", 12: "heating", 13: "12v",
  14: "220v", 15: "wood-stove", 16: "sauna", 17: "boat", 18: "toilet", 19: "drying-room", 20: "fishing",
  21: "fireplace", 22: "swimming", 23: "phone", 24: "canoe",
};

/** ut.no's SuitableFor ids. */
export const SUITABLE_FOR: Record<number, string> = { 1: "children", 2: "dogs", 4: "school-classes", 5: "pram" };

/** ut.no's AreaTypeEnum; REPORT_AREA and MAP_AREA are internal. */
export const AREA_TYPES: Record<string, AreaType> = {
  DNT_AREA: "dnt",
  PROTECTED_AREA: "protected",
  REINDEER_AREA: "reindeer",
  DNT_WORK_AREA: "dnt-association",
};

/** facilityIdsString is "|2|3|13|20|". */
const facilityKeys = (s: string | undefined) => {
  const keys = (s ?? "").split("|").flatMap((id) => FACILITIES[Number(id)] ?? []);
  return keys.length ? keys : undefined;
};

const suitableKeys = (v: unknown) => {
  const keys = Array.isArray(v) ? v.filter(isObj).flatMap((x) => SUITABLE_FOR[num(x, "id") ?? -1] ?? []) : [];
  return keys.length ? keys : undefined;
};

const names = (v: unknown) => {
  const out = Array.isArray(v) ? v.filter(isObj).flatMap((x) => str(x, "name") ?? []) : [];
  return out.length ? out : undefined;
};

/** Prefers the DNT area ("Jotunheimen") over protected or reindeer areas. */
function mainArea(raw: Raw): { id: string; name: string } | undefined {
  const areas = pick(raw, "areas");
  if (!Array.isArray(areas)) return undefined;
  const objs = areas.filter(isObj);
  const a = objs.find((x) => str(x, "areaType") === "DNT_AREA") ?? objs[0];
  if (!a) return undefined;
  const id = str(a, "id");
  const name = str(a, "name");
  return id && name ? { id, name } : undefined;
}

/** Extracts a hyttebestilling id from a booking URL like https://hyttebestilling.dnt.no/hytte/101265 */
export function bookingIdFromUrl(url: string | undefined): string | undefined {
  return url?.match(/hyttebestilling\.dnt\.no\/hytte\/(\d+)/)?.[1];
}

const isoDate = (v: string | undefined) => v?.slice(0, 10);

function opening(raw: Raw): CabinOpening {
  return {
    serviceLevel: serviceLevel(str(raw, "serviceLevel")),
    from: isoDate(str(raw, "from")),
    to: isoDate(str(raw, "to")),
    openAllYear: bool(raw, "openAllYear") ?? false,
    beds: num(raw, "beds"),
    requiresDntKey: str(raw, "key") ? str(raw, "key") === "dnt-key" : undefined,
  };
}

const BOOKING_LINE = /kl\.?\s*\d|drop-?in|forhåndsbestil|bestilling|reserv|ankomst|senger/i;

/** Lines of a cabin description that say something about booking, arrival or beds. */
export function bookingNotes(description: string | undefined): string[] | undefined {
  const lines = description?.split("\n").filter((l) => BOOKING_LINE.test(l));
  return lines?.length ? lines : undefined;
}

export function normalizeCabin(raw: Raw): Cabin {
  const id = str(raw, "id") ?? "";
  const geo = pick(raw, "geojson");
  const loc = latLon(geo);
  const coords = isObj(geo) && Array.isArray(geo.coordinates) ? geo.coordinates : [];
  const elevationM = num(raw, "elevationCustom") ?? (typeof coords[2] === "number" ? coords[2] : undefined);
  const today = pick(raw, "serviceStatusToday");
  const statuses = pick(raw, "serviceStatus");
  const openings = Array.isArray(statuses) ? statuses.filter(isObj).map(opening) : undefined;
  const todayKey = isObj(today) ? str(today, "key") : undefined;
  const description = htmlToText(str(raw, "description"));
  const summer = htmlToText(str(raw, "summertimeText"));
  const winter = htmlToText(str(raw, "wintertimeText"));
  return {
    id,
    name: str(raw, "name") ?? `Cabin ${id}`,
    serviceLevel: serviceLevel(str(raw, "serviceLevel")),
    dntCabin: bool(raw, "dntCabin") ?? false,
    requiresDntKey: todayKey ? todayKey === "dnt-key" : openings?.some((o) => o.requiresDntKey) || undefined,
    beds: {
      total: isObj(today) ? num(today, "beds") : undefined,
      staffed: num(raw, "bedsStaffed"),
      selfService: num(raw, "bedsSelfService"),
      noService: num(raw, "bedsNoService"),
      winter: num(raw, "bedsWinter"),
    },
    location: loc ? { ...loc, elevationM } : undefined,
    area: mainArea(raw),
    openings: openings?.length ? openings : undefined,
    description,
    access: summer || winter ? { summer, winter } : undefined,
    bookingNotes: bookingNotes(description),
    facilities: facilityKeys(str(raw, "facilityIdsString")),
    suitableFor: suitableKeys(pick(raw, "suitableFor")),
    municipalities: names(pick(raw, "municipalities")),
    url: `${WEB}/hytte/${id}`,
    routeIds: idList(pick(raw, "routeIds")),
    bookingId: bookingIdFromUrl(str(raw, "bookingUrl")),
    bookingUrl: bool(raw, "bookingEnabled") === false ? undefined : str(raw, "bookingUrl"),
    bookingOnly: bool(raw, "bookingOnly"),
  };
}

/** Decodes a Google encoded polyline (precision 5) into points. */
export function decodePolyline(s: string): LatLon[] {
  const out: LatLon[] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < s.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += next();
    lon += next();
    out.push({ lat: lat / 1e5, lon: lon / 1e5 });
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function normalizeTrip(raw: Raw): Trip {
  const id = str(raw, "id") ?? "";
  const distanceM = num(raw, "distance");
  const days = num(raw, "durationDays");
  const hours = num(raw, "durationHours");
  const minutes = num(raw, "durationMinutes");
  const multiDay = days !== undefined && days > 0;
  const polyline = str(raw, "encodedPolyline");
  const path = polyline ? decodePolyline(polyline) : [];
  const season = pick(raw, "season");
  const cabinIds = pick(raw, "cabinIds");
  return {
    id,
    name: str(raw, "name") ?? `Trip ${id}`,
    grading: grading(str(raw, "grading")),
    distanceKm: distanceM !== undefined ? round1(distanceM / 1000) : undefined,
    durationDays: multiDay ? days : undefined,
    durationHours: !multiDay && (hours !== undefined || minutes !== undefined) ? round1((hours ?? 0) + (minutes ?? 0) / 60) : undefined,
    ascentM: num(raw, "elevationGain"),
    descentM: num(raw, "elevationLoss"),
    start: latLon(pick(raw, "startPointGeojson")) ?? path[0],
    // For round trips (ABA) the polyline only covers the way out.
    end: str(raw, "direction") === "ABA" ? (latLon(pick(raw, "startPointGeojson")) ?? path[0]) : path.at(-1),
    seasonMonths: Array.isArray(season) ? season.filter((m): m is number => typeof m === "number") : undefined,
    activity: str(raw, "primaryActivityType")?.toLowerCase(),
    area: mainArea(raw),
    cabinIds: Array.isArray(cabinIds) ? cabinIds.map(String) : undefined,
    description: htmlToText(str(raw, "description")),
    url: `${WEB}/tur/${id}`,
  };
}

const idList = (v: unknown) => (Array.isArray(v) ? v.map(String) : undefined);

/** Hours from day/hour/minute fields; ski routes often report 0/0, meaning unknown. */
function duration(raw: Raw, suffix: string): Pick<RouteDirection, "durationDays" | "durationHours"> {
  const days = num(raw, `durationDays${suffix}`);
  if (days) return { durationDays: days };
  const hours = (num(raw, `durationHours${suffix}`) ?? 0) + (num(raw, `durationMinutes${suffix}`) ?? 0) / 60;
  return hours > 0 ? { durationHours: round1(hours) } : {};
}

export function normalizeRoute(raw: Raw): Route {
  const id = str(raw, "id") ?? "";
  const distanceM = num(raw, "distance");
  const polyline = str(raw, "encodedPolyline");
  const path = polyline ? decodePolyline(polyline) : [];
  const nonEmpty = (k: string) => str(raw, k) || undefined;
  return {
    id,
    name: str(raw, "name") ?? `Route ${id}`,
    code: nonEmpty("code"),
    type: nonEmpty("type"),
    from: nonEmpty("placeA"),
    to: nonEmpty("placeB"),
    via: nonEmpty("placeVia"),
    distanceKm: distanceM !== undefined ? round1(distanceM / 1000) : undefined,
    // The polyline runs from placeA to placeB.
    start: path[0],
    end: path.at(-1),
    maxElevationM: num(raw, "elevationMax"),
    // elevationGainA is the ascent when starting from A.
    forward: {
      grading: grading(str(raw, "gradingAb")),
      ...duration(raw, "Ab"),
      ascentM: num(raw, "elevationGainA"),
      descentM: num(raw, "elevationLossA"),
      description: htmlToText(str(raw, "descriptionAb")),
    },
    reverse: {
      grading: grading(str(raw, "gradingBa") ?? str(raw, "gradingAb")),
      ...duration(raw, "Ba"),
      ascentM: num(raw, "elevationGainB"),
      descentM: num(raw, "elevationLossB"),
      description: htmlToText(str(raw, "descriptionBa")),
    },
    winterMarking: nonEmpty("waymarkWinter"),
    notes: htmlToText(str(raw, "notes")),
    url: `${WEB}/rutebeskrivelse/${id}`,
  };
}

export function normalizeArea(raw: Raw): Area {
  const id = str(raw, "id") ?? "";
  return {
    id,
    name: str(raw, "name") ?? `Area ${id}`,
    type: AREA_TYPES[str(raw, "areaType") ?? ""] ?? "other",
    description: htmlToText(str(raw, "description")),
    url: `${WEB}/omrade/${id}`,
  };
}

/** Unwraps a connection `{ totalCount, edges: [{ node }] }` or a plain array. */
export function unwrapList(v: unknown): { nodes: Raw[]; total?: number } {
  if (Array.isArray(v)) return { nodes: v.filter(isObj) };
  if (!isObj(v)) return { nodes: [] };
  const edges = pick(v, "edges");
  const nodes = Array.isArray(edges) ? edges.map((e) => (isObj(e) && isObj(e.node) ? e.node : e)).filter(isObj) : [];
  return { nodes, total: num(v, "totalCount") };
}
