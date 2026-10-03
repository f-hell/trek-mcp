import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addDays } from "./dates.js";
import type { BookingInfo, Cabin, LatLon, NightAvailability, Route } from "./domain.js";
import { haversineKm } from "./geo.js";
import { cabinAtEnd, ENDPOINT_KM, endsAt, farEnd, namedEndAt, orient, orientTowards, preferType, seasonType, sortHours } from "./planning/routes.js";

/** How far from a route's endpoint to look for the cabin there. */
const END_RADIUS_KM = 1.5;
const round1 = (n: number) => Math.round(n * 10) / 10;
import { buildItinerary, DNT_BED_RULES, findStartDates, indexAvailability, judgeNight, type Stop, totalNights } from "./planning/itinerary.js";
import { compareTrips, findTrips, type Place, type Step, tripStats } from "./planning/trips.js";
import type { ProductKind } from "./sources/booking/normalize.js";
import type { BookingSource, CabinQuery, TrailSource } from "./sources/types.js";

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

/**
 * Which of a shared booking calendar's products belong to this cabin (see
 * ProductKind), by its service level on `date`: a staffed hut is
 * self-service outside its staffed season (Gjendebu after mid-September).
 */
export function productKind(cabin: Cabin, date?: string): ProductKind | undefined {
  const onDate = date ? periodOn(cabin, date)?.serviceLevel : undefined;
  const level = onDate && onDate !== "closed" && onDate !== "unknown" ? onDate : cabin.serviceLevel;
  return level === "staffed" ? "categories" : level === "self-service" || level === "no-service" ? "units" : undefined;
}

const SNIPPET_CHARS = 120;

/** Gathers calls made in the same tick into one `run` call over all their keys. */
function batched<K, V>(run: (keys: K[]) => Promise<V[]>): (key: K) => Promise<V> {
  let queue: { key: K; resolve: (v: V) => void; reject: (e: unknown) => void }[] = [];
  return (key) =>
    new Promise<V>((resolve, reject) => {
      if (!queue.length) {
        setTimeout(() => {
          const q = queue;
          queue = [];
          run(q.map((x) => x.key)).then(
            (values) => q.forEach((x, i) => x.resolve(values[i]!)),
            (e) => q.forEach((x) => x.reject(e)),
          );
        });
      }
      queue.push({ key, resolve, reject });
    });
}

/** Text around the first match of `word` in `text`, or undefined if there is none. */
export function snippet(text: string | undefined, word: string): string | undefined {
  const flat = (text ?? "").replace(/\s+/g, " ");
  const at = flat.toLowerCase().indexOf(word.toLowerCase());
  if (at < 0) return undefined;
  const from = Math.max(0, at - SNIPPET_CHARS);
  const to = Math.min(flat.length, at + word.length + SNIPPET_CHARS);
  return `${from > 0 ? "…" : ""}${flat.slice(from, to).trim()}${to < flat.length ? "…" : ""}`;
}

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

  /**
   * Cabin search as one short row per cabin; get_cabin has the full record.
   * `openOn` drops cabins in a closed period that day and adds the service
   * level then; `keyword` keeps cabins whose description mentions it and adds
   * the text around the match.
   */
  async searchCabins(q: CabinQuery & { openOn?: string; keyword?: string }) {
    const { openOn, keyword, ...query } = q;
    const where = (c: Cabin) =>
      (!openOn || periodOn(c, openOn)?.serviceLevel !== "closed") && (!keyword || snippet(c.description, keyword) !== undefined);
    const res = await this.trails.searchCabins(openOn || keyword ? { ...query, where } : query);
    const items = res.items.map((c) => {
      const period = openOn ? periodOn(c, openOn) : undefined;
      const match = keyword ? snippet(c.description, keyword) : undefined;
      const seasonBeds = [c.beds.staffed, c.beds.selfService, c.beds.noService].filter((n): n is number => n !== undefined);
      return {
        id: c.id,
        name: c.name,
        serviceLevel: c.serviceLevel,
        beds: period?.beds ?? (seasonBeds.length ? Math.max(...seasonBeds) : undefined),
        location: c.location,
        area: c.area?.name,
        municipalities: c.municipalities,
        facilities: c.facilities,
        suitableFor: c.suitableFor,
        requiresDntKey: c.requiresDntKey,
        bookable: !!this.withBookingId(c).bookingId,
        ...(openOn && { serviceLevelOn: period?.serviceLevel ?? "unknown" }),
        ...(match && { match }),
      };
    });
    return { ...res, items };
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
    // ponytail: one kind for the whole range, from its first night; split the request if ranges start crossing season changes.
    const nights = await this.booking.getAvailability(cabin.bookingId, from, to, productKind(cabin, from));
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
  async routesAt(cabins: Place[], type?: string): Promise<Route[][]> {
    const located = cabins.filter((c) => c.location);
    const near = located.length ? await this.trails.routesNearPoints(located.map((c) => c.location!), END_RADIUS_KM) : [];
    const byCabin = new Map(located.map((c, i) => [c.id, near[i] ?? []]));
    const missing = cabins.flatMap((c) => (c.routeIds ?? []).filter((id) => !byCabin.get(c.id)?.some((r) => r.id === id)));
    const extra = new Map((await this.trails.getRoutes(missing)).map((r) => [r.id, r]));
    return cabins.map((c) => {
      const all = [...(byCabin.get(c.id) ?? []), ...(c.routeIds ?? []).map((id) => extra.get(id)).filter((r): r is Route => !!r)];
      const unique = [...new Map(all.map((r) => [r.id, r])).values()];
      return unique.filter((r) => (endsAt(r, c) || namedEndAt(r, c, END_RADIUS_KM)) && (!type || r.type === type));
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
      routes: routes.map(({ toCabin, end: _, ...r }) => ({
        ...r,
        toCabin: toCabin && { id: toCabin.id, name: toCabin.name, serviceLevel: toCabin.serviceLevel },
      })),
      signatureRoutes: signature.map(({ id, name, durationDays, distanceKm }) => ({ id, name, durationDays, distanceKm })),
    };
  }

  /**
   * Routes out of `cabin`, oriented away from it, with the line's far end and
   * the cabin there. With `usable`, only cabins passing it count (a closed
   * staffed hut gives way to the self-service quarters next to it).
   */
  private async neighbours(cabin: Place, type?: string, usable?: (c: Cabin) => boolean) {
    const [routes = []] = await this.neighboursMany([cabin], type, usable);
    return { routes };
  }

  /** neighbours() for several places, in one batched request per lookup. */
  private async neighboursMany(places: Place[], type?: string, usable?: (c: Cabin) => boolean) {
    const routesPer = await this.routesAt(places, type);
    const ends = routesPer.map((routes, i) => routes.map((r) => farEnd(r, places[i]!)));
    const located = ends.flat().filter((p): p is LatLon => !!p);
    const near = located.length ? await this.trails.cabinsNearPoints(located, END_RADIUS_KM) : [];
    let k = 0;
    return routesPer.map((routes, i) =>
      routes
        .map((r, j) => {
          const place = places[i]!;
          const end = ends[i]![j];
          const o = orient(r, place);
          const candidates = end ? (near[k++] ?? []).filter((c) => !usable || usable(c.cabin)) : [];
          return { ...o, end, toCabin: end ? cabinAtEnd(r.id, candidates, place.id, o.to) : undefined };
        })
        .sort((a, b) => sortHours(a) - sortHours(b)),
    );
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
    const direct = first.filter((r) => atB(r.toCabin)).map(({ toCabin: _, end: _e, ...r }) => r);

    const vias = [...new Map(first.flatMap((r) => (r.toCabin && !atB(r.toCabin) ? [[r.toCabin.id, r.toCabin]] : []))).values()];
    const second = await this.routesAt(vias, type);
    const viaOneCabin = vias.flatMap((via, i) => {
      const toB = (second[i] ?? []).filter((r) => endsAt(r, b)).map((r) => orientTowards(r, b));
      const toVia = first.filter((r) => r.toCabin?.id === via.id);
      return toVia.flatMap(({ toCabin: _, end: _e, ...leg1 }) =>
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

  /**
   * Hut trips over the marked-route network: from a cabin or a point (a car
   * park), `nights` nights in different cabins, then back to the start (loop),
   * to `endCabinId`, or ending at the last cabin. With a start date, cabins
   * closed on their night are skipped and the best options get a bed check.
   */
  async findHutTrips(q: {
    startCabinId?: string;
    start?: LatLon;
    startName?: string;
    endCabinId?: string;
    loop?: boolean;
    nights: number;
    maxHoursPerDay?: number;
    type?: "foot" | "ski";
    startDate?: string;
    guests?: number;
    limit?: number;
  }) {
    const start: Place = q.startCabinId
      ? await this.getCabin(q.startCabinId)
      : { id: "start", name: q.startName ?? "Start", location: q.start };
    if (!start.location) throw new Error("Give startCabinId or start coordinates");
    const end: Place | undefined = q.loop ? start : q.endCabinId ? await this.getCabin(q.endCabinId) : undefined;
    const type = q.type ?? (q.startDate ? seasonType(q.startDate) : undefined);
    const dateOf = (day: number) => (q.startDate ? addDays(q.startDate, day) : undefined);

    // ut.no is asked about one search day's places together (one batched
    // request per lookup), not one cabin at a time: requests are throttled.
    const cache = new Map<string, Promise<Step[]>>();
    const lookups = new Map<string, (p: Place) => Promise<Step[]>>();
    const steps = (from: Place, day: number) => {
      // Cabins for a night must be open that night; the last day just walks out.
      const date = day < q.nights ? dateOf(day) : undefined;
      const key = `${from.id}:${date ?? ""}`;
      if (!lookups.has(date ?? "")) {
        lookups.set(date ?? "", batched((places: Place[]) => this.neighboursMany(places, type, date ? (c) => !isClosed(c, date) : undefined)));
      }
      if (!cache.has(key)) cache.set(key, lookups.get(date ?? "")!(from));
      return cache.get(key)!;
    };

    const trips = (await findTrips({ start, end, nights: q.nights, maxHoursPerDay: q.maxHoursPerDay, steps }))
      .map((legs) => ({ legs, stats: tripStats(legs) }))
      .sort((a, b) => compareTrips(a.stats, b.stats));
    const limit = q.limit ?? 5;

    // Bed check for the best options only: one calendar request per cabin.
    const guests = q.guests ?? 1;
    const calendars = new Map<string, Promise<NightAvailability[]>>();
    const nightVerdicts = async (legs: typeof trips[number]["legs"]) =>
      Promise.all(
        legs.slice(0, q.nights).map(async (l, i) => {
          const cabin = l.to as Cabin;
          if (!calendars.has(cabin.id)) calendars.set(cabin.id, this.availability(this.withBookingId(cabin), q.startDate!, dateOf(q.nights)!));
          const night = (await calendars.get(cabin.id)!).find((n) => n.date === dateOf(i));
          return { verdict: judgeNight(cabin, night, guests), bedsAvailable: night?.bedsAvailable };
        }),
      );
    const BLOCKED = new Set(["full", "closed", "insufficient"]);
    const checked = q.startDate
      ? (await Promise.all(trips.slice(0, limit * 2).map(async (t) => ({ ...t, beds: await nightVerdicts(t.legs) }))))
          // Stable sort: trips with a blocked night sink, otherwise the ranking holds.
          .sort((a, b) => Number(a.beds.some((n) => BLOCKED.has(n.verdict))) - Number(b.beds.some((n) => BLOCKED.has(n.verdict))))
      : trips.map((t) => ({ ...t, beds: undefined }));

    // With nothing found, say what is reachable so the caller can widen the search.
    let hint: string | undefined;
    if (!trips.length) {
      const firstDay = [...new Set((await steps(start, 0)).flatMap((st) => (st.toCabin ? [st.toCabin.name] : [])))];
      hint =
        `No ${end === start ? "loop" : "trip"} of ${q.nights} night(s) found${q.maxHoursPerDay ? ` within ${q.maxHoursPerDay} h a day` : ""}. ` +
        `Cabins one marked route from ${start.name}: ${firstDay.join(", ") || "none"}. ` +
        "Marked routes often branch out from hubs without closing into rings: try fewer nights, loop false (one way), a higher maxHoursPerDay, or a start among more cabins.";
    }

    return {
      start: start.name,
      end: end?.name,
      tripsFound: trips.length,
      hint,
      options: checked.slice(0, limit).map(({ legs, stats, beds }) => ({
        summary: [legs[0]?.from.name ?? start.name, ...legs.map((l) => l.to.name)].join(" → "),
        ...stats,
        days: legs.map((l, i) => ({
          date: dateOf(i),
          from: l.from.name,
          to: l.to.name,
          routeId: l.step.routeId,
          code: l.step.code,
          name: l.step.name,
          distanceKm: l.step.distanceKm,
          durationHours: l.step.durationHours,
          ascentM: l.step.ascentM,
          grading: l.step.grading,
          link: l.link,
          night: i < q.nights ? { cabinId: l.to.id, ...beds?.[i] } : undefined,
        })),
      })),
      bedRules: q.startDate ? DNT_BED_RULES : undefined,
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
  async bookingInfo(cabin: Cabin, date?: string): Promise<BookingInfo | undefined> {
    return cabin.bookingId ? this.booking.getBookingInfo(cabin.bookingId, productKind(cabin, date)) : undefined;
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
    for (const { cabin } of stops) if (!(cabin.id in info)) info[cabin.id] = await this.bookingInfo(cabin, opts.startDate);
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
