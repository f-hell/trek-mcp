import type { Cabin, LatLon } from "../domain.js";
import { haversineKm } from "../geo.js";
import { ENDPOINT_KM, type OrientedRoute } from "./routes.js";

/** A marked route out of a place, with the cabin at its far end if there is one, and the line's far end. */
export interface Step extends OrientedRoute {
  toCabin?: Cabin;
  end?: LatLon;
  /** For a day joined from several routes: the junctions, villages or road ends walked through */
  through?: string[];
}

/** Routes joined in one day, at most. */
const MAX_ROUTES_PER_DAY = 3;
/** Walking-time cap for a joined day when the search sets none. */
const JOINED_DAY_HOURS = 9;

/** Where a trip starts or ends: a cabin, or a point such as a car park (no routeIds). */
export type Place = Pick<Cabin, "id" | "name"> & Partial<Pick<Cabin, "location" | "routeIds">>;

export interface TripLeg {
  from: Place;
  to: Place;
  step: Step;
  /**
   * "listed": the cabins at both ends list the route on ut.no. "nearby": at
   * least one end was matched only because the line ends close to it, which
   * doesn't prove the path connects (a river can run between them).
   */
  link: "listed" | "nearby";
}

export interface TripSearch {
  start: Place;
  /** Where the last day ends (the start, for a loop); omit to end at the last night's cabin. */
  end?: Place;
  nights: number;
  maxHoursPerDay?: number;
  /**
   * Routes out of `from` on day `day` (0-based); days before `nights` end at
   * that night's cabin. `from` can be a junction (a route end with no cabin).
   */
  steps: (from: Place, day: number) => Promise<Step[]>;
  /** Stop collecting after this many trips. */
  maxTrips?: number;
}

/** True when a step ends at `place`: its cabin is the place or right next to it, or its line ends there. */
export function reaches(step: Step, place: Place): boolean {
  const near = (p?: LatLon) => !!p && !!place.location && haversineKm(p, place.location) <= ENDPOINT_KM;
  return step.toCabin?.id === place.id || near(step.toCabin?.location) || near(step.end);
}

// A joined day is "nearby": its routes meet where their lines end close together.
const leg = (from: Place, step: Step, to: Place): TripLeg => ({
  from,
  to,
  step,
  link: !step.through && from.routeIds?.includes(step.routeId) && to.routeIds?.includes(step.routeId) ? "listed" : "nearby",
});

const GRADES = ["easy", "moderate", "tough", "expert"];

/** Several routes walked in one day, as one step. */
export function joinSteps(parts: Step[]): Step {
  if (parts.length === 1) return parts[0]!;
  const last = parts[parts.length - 1]!;
  const sum = (f: (p: Step) => number | undefined) =>
    parts.every((p) => f(p) !== undefined) ? parts.reduce((t, p) => t + f(p)!, 0) : undefined;
  return {
    ...last,
    routeId: parts.map((p) => p.routeId).join("+"),
    code: parts.every((p) => p.code) ? parts.map((p) => p.code).join("+") : undefined,
    name: parts.map((p) => p.name).join(" + "),
    from: parts[0]!.from,
    distanceKm: sum((p) => p.distanceKm),
    durationHours: sum((p) => p.durationHours),
    ascentM: sum((p) => p.ascentM),
    descentM: sum((p) => p.descentM),
    maxElevationM: parts.some((p) => p.maxElevationM) ? Math.max(...parts.map((p) => p.maxElevationM ?? 0)) : undefined,
    grading: parts.map((p) => p.grading).reduce((a, b) => (GRADES.indexOf(b) > GRADES.indexOf(a) ? b : a)),
    url: parts[0]!.url,
    through: parts.slice(0, -1).map((p) => p.to ?? "junction"),
  };
}

/**
 * Every chain of marked routes from the start that sleeps `nights` nights in
 * different cabins and, with an end, walks to it on the last day. A day is one
 * marked route, or up to MAX_ROUTES_PER_DAY joined where one ends without a
 * cabin and the next begins.
 */
export async function findTrips(s: TripSearch): Promise<TripLeg[][]> {
  const trips: TripLeg[][] = [];
  const max = s.maxTrips ?? 500;
  const fits = (st: Step) => !s.maxHoursPerDay || st.durationHours === undefined || st.durationHours <= s.maxHoursPerDay;
  const joinedCap = s.maxHoursPerDay ?? JOINED_DAY_HOURS;

  /**
   * One day out of `at`: single routes, and routes joined through route ends
   * with no cabin (junctions, villages, road ends), within the day's hours.
   */
  const dayRoutes = async (at: Place, day: number): Promise<Step[]> => {
    const out: Step[] = [];
    let frontier: { place: Place; parts: Step[] }[] = [{ place: at, parts: [] }];
    for (let n = 1; n <= MAX_ROUTES_PER_DAY && frontier.length; n++) {
      const next: typeof frontier = [];
      await Promise.all(
        frontier.map(async ({ place, parts }) => {
          for (const st of await s.steps(place, day)) {
            if (parts.some((p) => p.routeId === st.routeId)) continue;
            const joined = joinSteps([...parts, st]);
            if (!fits(joined) || (n > 1 && (joined.durationHours === undefined || joined.durationHours > joinedCap))) continue;
            const arrives = st.toCabin || (s.end && day === s.nights && reaches(st, s.end));
            if (arrives) out.push(joined);
            else if (st.end) next.push({ place: { id: `at:${st.end.lat.toFixed(4)},${st.end.lon.toFixed(4)}`, name: st.to ?? "junction", location: st.end }, parts: [...parts, st] });
          }
        }),
      );
      frontier = next;
    }
    return out;
  };

  const visit = async (at: Place, day: number, legs: TripLeg[], slept: Set<string>): Promise<void> => {
    if (trips.length >= max) return;
    if (day === s.nights && !s.end) {
      trips.push(legs);
      return;
    }
    const steps = await dayRoutes(at, day);
    if (day === s.nights) {
      for (const st of steps) if (reaches(st, s.end!)) trips.push([...legs, leg(at, st, s.end!)]);
      return;
    }
    // Branches run together so the caller can batch each day's lookups.
    await Promise.all(
      steps.map((st) => {
        const to = st.toCabin;
        // Not a cabin, already slept in, or the start itself (or a cabin next to it).
        if (!to || slept.has(to.id) || reaches(st, s.start)) return undefined;
        return visit(to, day + 1, [...legs, leg(at, st, to)], new Set(slept).add(to.id));
      }),
    );
  };

  await visit(s.start, 0, [], new Set());
  return trips;
}

export interface TripStats {
  totalKm: number;
  totalHours?: number;
  maxDayHours?: number;
  guessedLinks: number;
  /** Routes walked more than once (out and back) */
  repeatedRoutes: number;
}

export function tripStats(legs: TripLeg[]): TripStats {
  const hours = legs.map((l) => l.step.durationHours);
  const known = hours.every((h): h is number => h !== undefined);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    totalKm: round1(legs.reduce((s, l) => s + (l.step.distanceKm ?? 0), 0)),
    totalHours: known && hours.length ? round1(hours.reduce((s, h) => s + h, 0)) : undefined,
    maxDayHours: known && hours.length ? Math.max(...hours) : undefined,
    guessedLinks: legs.filter((l) => l.link === "nearby").length,
    repeatedRoutes: legs.length - new Set(legs.map((l) => l.step.routeId)).size,
  };
}

/** Confirmed links first, then real loops before out-and-back, then the easiest longest day. */
export function compareTrips(a: TripStats, b: TripStats): number {
  return (
    a.guessedLinks - b.guessedLinks ||
    a.repeatedRoutes - b.repeatedRoutes ||
    (a.maxDayHours ?? 1e9) - (b.maxDayHours ?? 1e9) ||
    (a.totalHours ?? 1e9) - (b.totalHours ?? 1e9)
  );
}
