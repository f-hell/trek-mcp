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
  | "ok" // source confirms enough beds
  | "likely" // marked available but bed count unknown
  | "insufficient" // available, but fewer beds than guests
  | "full"
  | "closed"
  | "not-bookable" // cabin not on hyttebestilling (ubetjent, first come first served, etc.)
  | "unknown";

export interface PlannedNight {
  date: string;
  cabinId: string;
  cabinName: string;
  verdict: NightVerdict;
  bedsAvailable?: number;
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
  problems: string[];
}

export function indexAvailability(byCabin: Record<string, NightAvailability[]>): AvailabilityIndex {
  const idx: AvailabilityIndex = new Map();
  for (const [cabinId, nights] of Object.entries(byCabin)) {
    idx.set(cabinId, new Map(nights.map((n) => [n.date, n])));
  }
  return idx;
}

export function judgeNight(cabin: Cabin, night: NightAvailability | undefined, guests: number): NightVerdict {
  if (!cabin.bookingId) return "not-bookable";
  if (!night) return "unknown";
  switch (night.status) {
    case "full":
      return "full";
    case "closed":
      return "closed";
    case "unknown":
      return "unknown";
    case "available":
      if (night.bedsAvailable === undefined) return "likely";
      return night.bedsAvailable >= guests ? "ok" : "insufficient";
  }
}

const BLOCKING: NightVerdict[] = ["insufficient", "full", "closed"];

export function buildItinerary(stops: Stop[], startDate: string, guests: number, availability: AvailabilityIndex): Itinerary {
  const nights: PlannedNight[] = [];
  const legs: Leg[] = [];
  const problems: string[] = [];
  let date = startDate;

  stops.forEach((stop, i) => {
    for (const d of dateRange(date, addDays(date, stop.nights))) {
      const night = availability.get(stop.cabin.id)?.get(d);
      const verdict = judgeNight(stop.cabin, night, guests);
      nights.push({ date: d, cabinId: stop.cabin.id, cabinName: stop.cabin.name, verdict, bedsAvailable: night?.bedsAvailable });
      if (BLOCKING.includes(verdict)) problems.push(`${d} ${stop.cabin.name}: ${verdict}`);
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

  return { startDate, endDate: date, guests, nights, legs, feasible: problems.length === 0, problems };
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
