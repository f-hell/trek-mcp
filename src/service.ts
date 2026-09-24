import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addDays } from "./dates.js";
import type { Cabin, NightAvailability } from "./domain.js";
import { buildItinerary, DNT_BED_RULES, findStartDates, indexAvailability, type Stop, totalNights } from "./planning/itinerary.js";
import type { BookingSource, TrailSource } from "./sources/types.js";

function loadCabinMap(): Record<string, string> {
  try {
    const file = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "cabin-map.json");
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => !e[0].startsWith("_") && typeof e[1] === "string"));
  } catch {
    return {};
  }
}

const periodOn = (cabin: Cabin, date: string) =>
  cabin.openings?.find((o) => !o.openAllYear && o.from && o.to && o.from <= date && date < o.to) ??
  cabin.openings?.find((o) => o.openAllYear);

/** True when the cabin's opening periods put `date` in a closed period. */
export function isClosed(cabin: Cabin, date: string): boolean {
  return periodOn(cabin, date)?.serviceLevel === "closed";
}

/** Beds the cabin has on `date` that can't be booked online (first come, first served). */
export function dropInBeds(cabin: Cabin, night: NightAvailability): number | undefined {
  const seasonBeds = periodOn(cabin, night.date)?.beds;
  if (seasonBeds === undefined || night.bookableBeds === undefined) return undefined;
  return Math.max(0, seasonBeds - night.bookableBeds);
}

/** Combines trail data and booking data; the MCP tools call into this. */
export class TrekService {
  constructor(
    readonly trails: TrailSource,
    readonly booking: BookingSource,
    private readonly cabinMap: Record<string, string> = loadCabinMap(),
  ) {}

  withBookingId(cabin: Cabin): Cabin {
    const mapped = this.cabinMap[cabin.id];
    return mapped && !cabin.bookingId ? { ...cabin, bookingId: mapped } : cabin;
  }

  async getCabin(id: string): Promise<Cabin> {
    const cabin = await this.trails.getCabin(id);
    if (!cabin) throw new Error(`No cabin with id ${id}`);
    return this.withBookingId(cabin);
  }

  /**
   * Booking availability, with nights that ut.no lists as outside the cabin's
   * open periods marked closed (the booking calendar reports those as 0 beds).
   */
  async availability(cabin: Cabin, from: string, to: string): Promise<NightAvailability[]> {
    if (!cabin.bookingId) return [];
    const nights = await this.booking.getAvailability(cabin.bookingId, from, to);
    return nights.map((n): NightAvailability => {
      if (isClosed(cabin, n.date)) return { date: n.date, status: "closed" };
      const dropIn = dropInBeds(cabin, n);
      return dropIn === undefined ? n : { ...n, dropInBeds: dropIn };
    });
  }

  async planHutToHut(opts: {
    stops: { cabinId: string; nights: number }[];
    startDate: string;
    guests: number;
    flexDays: number;
  }) {
    const stops: Stop[] = [];
    for (const s of opts.stops) stops.push({ cabin: await this.getCabin(s.cabinId), nights: s.nights });

    // One availability request per cabin spanning every candidate start date.
    const windowEnd = addDays(opts.startDate, opts.flexDays);
    const lastNight = addDays(windowEnd, totalNights(stops));
    const byCabin: Record<string, NightAvailability[]> = {};
    for (const { cabin } of stops) {
      if (!(cabin.id in byCabin)) byCabin[cabin.id] = await this.availability(cabin, opts.startDate, lastNight);
    }
    const idx = indexAvailability(byCabin);

    const itinerary = buildItinerary(stops, opts.startDate, opts.guests, idx);
    const alternatives = opts.flexDays > 0 ? findStartDates(stops, opts.startDate, windowEnd, opts.guests, idx) : [];
    const bookingLinks = Object.fromEntries(
      stops.flatMap(({ cabin }) => {
        const url = cabin.bookingId ? this.booking.bookingUrl(cabin.bookingId) : cabin.bookingUrl;
        return url ? [[cabin.name, url]] : [];
      }),
    );
    return { itinerary, alternatives, bookingLinks, bedRules: DNT_BED_RULES };
  }
}
