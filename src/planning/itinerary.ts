import { addDays, dateRange } from "../dates.js";
import type { Cabin, NightAvailability } from "../domain.js";
import { haversineKm } from "../geo.js";

export interface Stop {
  cabin: Cabin;
  nights: number;
}

/** Availability per cabin id, keyed by ISO date. */
export type AvailabilityIndex = Map<string, Map<string, NightAvailability>>;

export type NightVerdict =
  | "ok" // source confirms enough bookable beds
  | "likely" // marked available but bed count unknown
  | "drop-in" // too few bookable beds, but enough first-come beds that can't be pre-booked
  | "insufficient" // available, but fewer beds than guests
  | "full"
  | "closed"
  | "book-elsewhere" // booked through the cabin's own site; check there
  | "first-come" // no online booking at all
  | "unknown";

/**
 * How DNT beds work, for the model to explain to the user. Returned with
 * availability and plans.
 */
export const DNT_BED_RULES = [
  "Almost all DNT cabins take drop-in guests. Some beds can't be pre-booked and go first come, first served.",
  "A pre-booked bed must be claimed by 19:00 (21:00 at a few cabins). After that, unclaimed beds go to drop-in guests.",
  "A late arrival keeps a paid stay but loses the right to that bed, and takes whatever beds are free on arrival.",
];

export interface PlannedNight {
  date: string;
  cabinId: string;
  cabinName: string;
  verdict: NightVerdict;
  bedsAvailable?: number;
  dropInBeds?: number;
}

export interface Leg {
  from: string;
  to: string;
  /** Departure date (morning after the last night at `from`). */
  date: string;
  straightLineKm?: number;
}

export interface Itinerary {
  startDate: string;
  endDate: string;
  guests: number;
  nights: PlannedNight[];
  legs: Leg[];
  feasible: boolean;
  /** Nights that block the plan */
  problems: string[];
  /** Nights that work but aren't guaranteed by a booking */
  warnings: string[];
}

export function indexAvailability(byCabin: Record<string, NightAvailability[]>): AvailabilityIndex {
  const idx: AvailabilityIndex = new Map();
  for (const [cabinId, nights] of Object.entries(byCabin)) {
    idx.set(cabinId, new Map(nights.map((n) => [n.date, n])));
  }
  return idx;
}

export function judgeNight(cabin: Cabin, night: NightAvailability | undefined, guests: number): NightVerdict {
  if (!cabin.bookingId) return cabin.bookingUrl ? "book-elsewhere" : "first-come";
  if (!night) return "unknown";
  if (night.status === "closed" || night.status === "unknown") return night.status;
  if (night.status === "available" && night.bedsAvailable === undefined) return "likely";
  const bookable = night.bedsAvailable ?? 0;
  if (bookable >= guests) return "ok";
  if (night.dropInBeds !== undefined && bookable + night.dropInBeds >= guests) return "drop-in";
  return night.status === "full" ? "full" : "insufficient";
}

const BLOCKING: NightVerdict[] = ["insufficient", "full", "closed"];
const WARN: Partial<Record<NightVerdict, string>> = {
  "drop-in": "not enough bookable beds; relies on first-come beds, so arrive early",
  "book-elsewhere": "booked on the cabin's own site; check availability there",
  "first-come": "no online booking; first come, first served",
};

export function buildItinerary(stops: Stop[], startDate: string, guests: number, availability: AvailabilityIndex): Itinerary {
  const nights: PlannedNight[] = [];
  const legs: Leg[] = [];
  const problems: string[] = [];
  const warnings: string[] = [];
  let date = startDate;

  stops.forEach((stop, i) => {
    for (const d of dateRange(date, addDays(date, stop.nights))) {
      const night = availability.get(stop.cabin.id)?.get(d);
      const verdict = judgeNight(stop.cabin, night, guests);
      nights.push({
        date: d,
        cabinId: stop.cabin.id,
        cabinName: stop.cabin.name,
        verdict,
        bedsAvailable: night?.bedsAvailable,
        dropInBeds: night?.dropInBeds,
      });
      if (BLOCKING.includes(verdict)) problems.push(`${d} ${stop.cabin.name}: ${verdict}`);
      const warning = WARN[verdict];
      if (warning) warnings.push(`${d} ${stop.cabin.name}: ${warning}`);
    }
    date = addDays(date, stop.nights);
    const next = stops[i + 1];
    if (next) {
      const a = stop.cabin.location;
      const b = next.cabin.location;
      legs.push({
        from: stop.cabin.name,
        to: next.cabin.name,
        date,
        straightLineKm: a && b ? Math.round(haversineKm(a, b) * 10) / 10 : undefined,
      });
    }
  });

  return { startDate, endDate: date, guests, nights, legs, feasible: problems.length === 0, problems, warnings };
}

/**
 * Start dates in [windowFrom, windowTo] where no night of the trip is blocked.
 * Nights with unknown availability don't disqualify a date but are reported.
 */
export function findStartDates(
  stops: Stop[],
  windowFrom: string,
  windowTo: string,
  guests: number,
  availability: AvailabilityIndex,
): { startDate: string; uncertainNights: number }[] {
  const results: { startDate: string; uncertainNights: number }[] = [];
  for (const start of dateRange(windowFrom, addDays(windowTo, 1))) {
    const it = buildItinerary(stops, start, guests, availability);
    if (it.feasible) {
      results.push({ startDate: start, uncertainNights: it.nights.filter((n) => n.verdict !== "ok").length });
    }
  }
  return results;
}

export const totalNights = (stops: Stop[]) => stops.reduce((s, x) => s + x.nights, 0);
