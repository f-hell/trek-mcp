import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addDays } from "./dates.js";
import type { BookingInfo, Cabin, LatLon, NightAvailability, Route } from "./domain.js";
import { haversineKm } from "./geo.js";
import { cabinAtEnd, ENDPOINT_KM, endsAt, farEnd, orient, orientTowards, preferType, seasonType, sortHours } from "./planning/routes.js";

/** How far from a route's endpoint to look for the cabin there. */
const END_RADIUS_KM = 1.5;
/** Routes passing this close to a cabin are candidates for starting or ending there. */
const AT_CABIN_KM = 0.5;
const round1 = (n: number) => Math.round(n * 10) / 10;
import { buildItinerary, DNT_BED_RULES, findStartDates, indexAvailability, type Stop, totalNights } from "./planning/itinerary.js";
import type { ProductKind } from "./sources/booking/normalize.js";
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

/** Which of a shared booking calendar's products belong to this cabin (see ProductKind). */
const productKind = (cabin: Cabin): ProductKind | undefined =>
  cabin.serviceLevel === "staffed" ? "categories" : cabin.serviceLevel === "self-service" || cabin.serviceLevel === "no-service" ? "units" : undefined;

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
   * Booking availability cross-checked with ut.no's open periods. A night in a
   * closed period is marked closed (the booking calendar reports those as 0
   * beds), unless hyttebestilling still sells beds that night; then the
   * booking data is kept and the disagreement is noted.
   */
  async availability(cabin: Cabin, from: string, to: string): Promise<NightAvailability[]> {
    if (!cabin.bookingId) return [];
    const nights = await this.booking.getAvailability(cabin.bookingId, from, to, productKind(cabin));
    return nights.map((n): NightAvailability => {
      if (isClosed(cabin, n.date)) {
        if (!n.bedsAvailable) return { date: n.date, status: "closed" };
        return { ...n, note: "ut.no lists a closed period, but hyttebestilling sells beds this night; check with the cabin" };
      }
      const dropIn = dropInBeds(cabin, n);
      return dropIn === undefined ? n : { ...n, dropInBeds: dropIn };
    });
  }

  /**
   * Marked routes that start or end at each cabin: routes passing close to it
   * (one batched request) whose line ends there, plus the cabin's own route ids.
   */
  async routesAt(cabins: Cabin[], type?: string): Promise<Route[][]> {
    const located = cabins.filter((c) => c.location);
    const near = located.length ? await this.trails.routesNearPoints(located.map((c) => c.location!), AT_CABIN_KM) : [];
    const byCabin = new Map(located.map((c, i) => [c.id, near[i] ?? []]));
    const missing = cabins.flatMap((c) => (c.routeIds ?? []).filter((id) => !byCabin.get(c.id)?.some((r) => r.id === id)));
    const extra = new Map((await this.trails.getRoutes(missing)).map((r) => [r.id, r]));
    return cabins.map((c) => {
      const all = [...(byCabin.get(c.id) ?? []), ...(c.routeIds ?? []).map((id) => extra.get(id)).filter((r): r is Route => !!r)];
      const unique = [...new Map(all.map((r) => [r.id, r])).values()];
      return unique.filter((r) => endsAt(r, c) && (!type || r.type === type));
    });
  }

  /**
   * Marked routes out of a cabin, seen from the cabin, with the cabin at the
   * other end where there is one. Also lists signature routes through it.
   */
  async routesFromCabin(cabinId: string, type?: string) {
    const cabin = await this.getCabin(cabinId);
    const { routes } = await this.neighbours(cabin, type);
    const signature = (await this.trails.signatureRoutes()).filter((t) => t.cabinIds?.includes(cabin.id));
    return {
      cabin: { id: cabin.id, name: cabin.name },
      routes: routes.map(({ toCabin, ...r }) => ({
        ...r,
        toCabin: toCabin && { id: toCabin.id, name: toCabin.name, serviceLevel: toCabin.serviceLevel },
      })),
      signatureRoutes: signature.map(({ id, name, durationDays, distanceKm }) => ({ id, name, durationDays, distanceKm })),
    };
  }

  /** Routes out of `cabin`, oriented away from it, with the cabin at each far end. */
  private async neighbours(cabin: Cabin, type?: string) {
    const [routes = []] = await this.routesAt([cabin], type);
    const ends = routes.map((r) => farEnd(r, cabin));
    const located = ends.filter((p): p is LatLon => !!p);
    const near = located.length ? await this.trails.cabinsNearPoints(located, END_RADIUS_KM) : [];
    let k = 0;
    const out = routes.map((r, i) => {
      const o = orient(r, cabin);
      return { ...o, toCabin: ends[i] ? cabinAtEnd(r.id, near[k++] ?? [], cabin.id, o.to) : undefined };
    });
    return { routes: out.sort((a, b) => sortHours(a) - sortHours(b)) };
  }

  /**
   * Marked routes between two cabins: direct routes, and two-leg routes via
   * one cabin that has a marked route to each.
   */
  async routesBetween(fromId: string, toId: string, type?: string) {
    const [a, b] = [await this.getCabin(fromId), await this.getCabin(toId)];
    const { routes: first } = await this.neighbours(a, type);
    // A staffed hut and its self-service quarters are separate cabins at one
    // spot (Gjendebu, Gjendebu Selvbetjent); a route to either reaches both.
    const atB = (c?: Cabin) =>
      !!c && (c.id === b.id || (!!c.location && !!b.location && haversineKm(c.location, b.location) <= ENDPOINT_KM));
    const direct = first.filter((r) => atB(r.toCabin)).map(({ toCabin: _, ...r }) => r);

    const vias = [...new Map(first.flatMap((r) => (r.toCabin && !atB(r.toCabin) ? [[r.toCabin.id, r.toCabin]] : []))).values()];
    const second = await this.routesAt(vias, type);
    const viaOneCabin = vias.flatMap((via, i) => {
      const toB = (second[i] ?? []).filter((r) => endsAt(r, b)).map((r) => orientTowards(r, b));
      const toVia = first.filter((r) => r.toCabin?.id === via.id);
      return toVia.flatMap(({ toCabin: _, ...leg1 }) =>
        toB.map((leg2) => ({
          via: { id: via.id, name: via.name, serviceLevel: via.serviceLevel },
          legs: [leg1, leg2],
          totalKm: round1((leg1.distanceKm ?? 0) + (leg2.distanceKm ?? 0)),
          totalHours: leg1.durationHours && leg2.durationHours ? round1(leg1.durationHours + leg2.durationHours) : undefined,
        })),
      );
    });
    const straightLineKm = a.location && b.location ? round1(haversineKm(a.location, b.location)) : undefined;
    return {
      from: { id: a.id, name: a.name },
      to: { id: b.id, name: b.name },
      straightLineKm,
      direct,
      viaOneCabin: viaOneCabin.sort((x, y) => (x.totalHours ?? 1e9) - (y.totalHours ?? 1e9) || x.totalKm - y.totalKm),
    };
  }

  /** DNT's signature long-distance routes, optionally filtered. */
  async signatureRoutes(q: { text?: string; areaId?: string; cabinId?: string; near?: LatLon & { radiusKm: number }; maxDays?: number }) {
    const text = q.text?.toLowerCase();
    return (await this.trails.signatureRoutes())
      .filter(
        (t) =>
          (!text || t.name.toLowerCase().includes(text) || t.area?.name.toLowerCase().includes(text)) &&
          (!q.areaId || t.area?.id === q.areaId) &&
          (!q.cabinId || t.cabinIds?.includes(q.cabinId)) &&
          (!q.maxDays || (t.durationDays ?? 1) <= q.maxDays) &&
          (!q.near || [t.start, t.end].some((p) => p && haversineKm(q.near!, p) <= q.near!.radiusKm)),
      )
      .map(({ description: _, ...t }) => t);
  }

  /** hyttebestilling's notices and booking limits for the cabin, if it's booked there. */
  async bookingInfo(cabin: Cabin): Promise<BookingInfo | undefined> {
    return cabin.bookingId ? this.booking.getBookingInfo(cabin.bookingId, productKind(cabin)) : undefined;
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

    // Cross-check with each cabin's booking page and its ut.no text.
    const info: Record<string, BookingInfo | undefined> = {};
    for (const { cabin } of stops) if (!(cabin.id in info)) info[cabin.id] = await this.bookingInfo(cabin);
    let date = opts.startDate;
    for (const { cabin, nights } of stops) {
      const i = info[cabin.id];
      const last = addDays(date, nights - 1);
      if (i?.maxNights && nights > i.maxNights) {
        itinerary.problems.push(`${cabin.name}: ${nights} nights, but hyttebestilling allows at most ${i.maxNights} per booking`);
      }
      if (i?.minNights && nights < i.minNights) {
        itinerary.problems.push(`${cabin.name}: ${nights} nights, but hyttebestilling requires at least ${i.minNights}`);
      }
      const closed = i?.bookingClosed;
      if (closed && (!closed.to || date < closed.to) && (!closed.from || last >= closed.from)) {
        itinerary.warnings.push(`${cabin.name}: online booking is closed ${closed.from ?? "…"} to ${closed.to ?? "…"}`);
      }
      if (i?.statusMessage) itinerary.warnings.push(`${cabin.name}: ${i.statusMessage}`);
      date = addDays(date, nights);
    }
    for (const n of itinerary.nights) {
      const note = idx.get(n.cabinId)?.get(n.date)?.note;
      if (note) itinerary.warnings.push(`${n.date} ${n.cabinName}: ${note}`);
    }
    // Marked routes for each leg, in the season's type (foot/ski) when there's a choice.
    const atStop = stops.length > 1 ? await this.routesAt(stops.slice(0, -1).map((s) => s.cabin)) : [];
    itinerary.legs.forEach((leg, i) => {
      const [a, b] = [stops[i]!.cabin, stops[i + 1]!.cabin];
      const routes = (atStop[i] ?? []).filter((r) => endsAt(r, b)).map((r) => orient(r, a));
      leg.routes = preferType(routes, seasonType(leg.date)).sort((x, y) => sortHours(x) - sortHours(y));
      if (!leg.routes.length) {
        itinerary.warnings.push(`${leg.date} ${a.name} → ${b.name}: no direct marked route; see find_routes_between_cabins`);
      }
    });
    itinerary.feasible = itinerary.problems.length === 0;
    const alternatives = opts.flexDays > 0 ? findStartDates(stops, opts.startDate, windowEnd, opts.guests, idx) : [];
    const bookingLinks = Object.fromEntries(
      stops.flatMap(({ cabin }) => {
        const url = cabin.bookingId ? this.booking.bookingUrl(cabin.bookingId) : cabin.bookingUrl;
        return url ? [[cabin.name, url]] : [];
      }),
    );
    const cabinNotes = Object.fromEntries(
      stops.map(({ cabin }) => {
        const { siteNotices: _, ...booking } = info[cabin.id] ?? {};
        return [cabin.name, { utno: cabin.bookingNotes, hyttebestilling: Object.keys(booking).length ? booking : undefined }];
      }),
    );
    const siteNotices = [...new Set(Object.values(info).flatMap((i) => i?.siteNotices ?? []))];
    return {
      itinerary,
      alternatives,
      bookingLinks,
      cabinNotes,
      siteNotices: siteNotices.length ? siteNotices : undefined,
      bedRules: DNT_BED_RULES,
    };
  }
}
