import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addDays } from "./dates.js";
import type { Cabin, NightAvailability } from "./domain.js";
import { buildItinerary, findStartDates, indexAvailability, type Stop, totalNights } from "./planning/itinerary.js";
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

  async availability(cabin: Cabin, from: string, to: string): Promise<NightAvailability[]> {
    return cabin.bookingId ? this.booking.getAvailability(cabin.bookingId, from, to) : [];
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
      stops.filter((s) => s.cabin.bookingId).map((s) => [s.cabin.name, this.booking.bookingUrl(s.cabin.bookingId!)]),
    );
    return { itinerary, alternatives, bookingLinks };
  }
}
