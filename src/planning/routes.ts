import type { Cabin, Grading, LatLon, Route } from "../domain.js";
import { haversineKm } from "../geo.js";

/** A marked route seen from one end: the stats are for walking/skiing away from `from`. */
export interface OrientedRoute {
  routeId: string;
  name: string;
  code?: string;
  type?: string;
  from?: string;
  to?: string;
  via?: string;
  distanceKm?: number;
  grading: Grading;
  durationHours?: number;
  durationDays?: number;
  ascentM?: number;
  descentM?: number;
  maxElevationM?: number;
  winterMarking?: string;
  /** True when this is the route's B → A direction */
  reversed: boolean;
  url: string;
}

const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-zæøå0-9]/g, "");

const sameName = (a: string, b: string) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));

/**
 * True when `origin` is the route's `to` place, i.e. travel from there uses
 * the reverse stats. The names decide: ut.no sometimes draws the line in the
 * opposite direction to placeA → placeB. Geometry (line assumed A → B) is
 * only the fallback when the names don't tell.
 */
export function startsAtEnd(route: Route, origin: { location?: LatLon; name?: string }): boolean {
  const name = norm(origin.name);
  const [from, to] = [norm(route.from), norm(route.to)];
  const isFrom = sameName(name, from);
  const isTo = sameName(name, to);
  if (isFrom !== isTo) return isTo;
  if (origin.location && route.start && route.end) {
    return haversineKm(origin.location, route.end) < haversineKm(origin.location, route.start);
  }
  return false;
}

export function orient(route: Route, origin: { location?: LatLon; name?: string }): OrientedRoute {
  return oriented(route, startsAtEnd(route, origin));
}

/** The route in the direction that ends at `destination`. */
export function orientTowards(route: Route, destination: { location?: LatLon; name?: string }): OrientedRoute {
  return oriented(route, !startsAtEnd(route, destination));
}

function oriented(route: Route, reversed: boolean): OrientedRoute {
  const dir = reversed ? route.reverse : route.forward;
  return {
    routeId: route.id,
    name: route.name,
    code: route.code,
    type: route.type,
    from: reversed ? route.to : route.from,
    to: reversed ? route.from : route.to,
    via: route.via,
    distanceKm: route.distanceKm,
    grading: dir.grading,
    durationHours: dir.durationHours,
    durationDays: dir.durationDays,
    ascentM: dir.ascentM,
    descentM: dir.descentM,
    maxElevationM: route.maxElevationM,
    winterMarking: route.winterMarking,
    reversed,
    url: route.url,
  };
}

/** The line's endpoint farther from `origin` (pure geometry). */
export function farEnd(route: Route, origin: { location?: LatLon; name?: string }): LatLon | undefined {
  if (origin.location && route.start && route.end) {
    return haversineKm(origin.location, route.start) > haversineKm(origin.location, route.end) ? route.start : route.end;
  }
  return startsAtEnd(route, origin) ? route.start : route.end;
}

/** How close a line's endpoint must be to a cabin for the route to start or end there. */
export const ENDPOINT_KM = 0.75;

/** True when one of the route's endpoints is at the cabin. */
export const endsAt = (route: Route, cabin: { location?: LatLon; routeIds?: string[]; id?: string }): boolean =>
  !!cabin.routeIds?.includes(route.id) ||
  (!!cabin.location && [route.start, route.end].some((p) => p && haversineKm(p, cabin.location!) <= ENDPOINT_KM));

/**
 * True when the route names the place at one end ("Dyrkolbotn" for Dyrkolbotn
 * Fjellstove) and that end of the line is within `km`: a trailhead a short
 * walk from the cabin, further than ENDPOINT_KM.
 */
export function namedEndAt(route: Route, place: { location?: LatLon; name?: string }, km: number): boolean {
  if (!place.location || !route.start || !route.end) return false;
  const name = norm(place.name);
  const ends: [string | undefined, LatLon][] = [
    [route.from, route.start],
    [route.to, route.end],
    // The line may be drawn the other way round (see startsAtEnd).
    [route.from, route.end],
    [route.to, route.start],
  ];
  return ends.some(([n, p]) => sameName(name, norm(n)) && haversineKm(place.location!, p) <= km);
}

/**
 * Picks the cabin at a route's far end from nearby candidates, in order: the
 * one named exactly like the route's place (Glitterheim, not "Glitterheim
 * Selvbetjent"), one whose name contains it, one that lists the route among
 * its own routes, and finally the nearest within `maxM`.
 */
export function cabinAtEnd(
  routeId: string,
  candidates: { cabin: Cabin; distanceM: number }[],
  exclude: string,
  placeName?: string,
  maxM = 500,
): Cabin | undefined {
  const others = candidates.filter((c) => c.cabin.id !== exclude);
  const place = norm(placeName);
  return (
    (place ? others.find((c) => norm(c.cabin.name) === place) : undefined) ??
    (place ? others.find((c) => sameName(norm(c.cabin.name), place)) : undefined) ??
    others.find((c) => c.cabin.routeIds?.includes(routeId)) ??
    others.find((c) => c.distanceM <= maxM)
  )?.cabin;
}

/** "foot" in the summer half of the year (June–October), otherwise "ski". */
export const seasonType = (isoDate: string): "foot" | "ski" => {
  const month = Number(isoDate.slice(5, 7));
  return month >= 6 && month <= 10 ? "foot" : "ski";
};

/** Routes of the preferred type if there are any, else all of them. */
export function preferType<T extends { type?: string }>(routes: T[], type: string | undefined): T[] {
  if (!type) return routes;
  const matching = routes.filter((r) => r.type === type);
  return matching.length ? matching : routes;
}

/** Time for sorting: days count as 8 walking hours; unknown sorts last. */
export const sortHours = (r: { durationHours?: number; durationDays?: number }) =>
  r.durationDays ? r.durationDays * 8 : (r.durationHours ?? Number.POSITIVE_INFINITY);
