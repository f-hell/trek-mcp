import { config } from "../../config.js";
import type { Area, Cabin, Grading, LatLon, Paged, Route, ServiceLevel, Trip } from "../../domain.js";
import { PoliteHttp } from "../../http.js";
import { isObj, pick, type Raw, str } from "../normalize.js";
import type { CabinQuery, TrailSource, TripQuery } from "../types.js";
import { normalizeArea, normalizeCabin, normalizeRoute, normalizeTrip, unwrapList } from "./normalize.js";
import * as Q from "./queries.js";

interface GqlResponse {
  data?: Record<string, unknown>;
  errors?: { message: string }[];
}

const SERVICE_LEVELS: Record<ServiceLevel, string[]> = {
  staffed: ["STAFFED"],
  "self-service": ["SELF_SERVICE"],
  "no-service": ["NO_SERVICE", "NO_SERVICE_NO_BEDS"],
  emergency: ["EMERGENCY_SHELTER"],
  closed: ["CLOSED"],
  unknown: ["UNKNOWN", "FOOD_SERVICE", "RENTAL"],
};

const GRADINGS: Record<Grading, string[]> = {
  easy: ["HIGHLY_ACCESSIBLE", "EASY"],
  moderate: ["MODERATE"],
  tough: ["TOUGH"],
  expert: ["VERY_TOUGH"],
  unknown: [],
};

/** Case-insensitive substring match for nestjs-query's iLike. */
const iLike = (text: string) => ({ iLike: `%${text.replace(/[%_\\]/g, "")}%` });

const areaIds = (raw: Raw): string[] => {
  const areas = pick(raw, "areas");
  return Array.isArray(areas) ? areas.filter(isObj).map((a) => str(a, "id") ?? "") : [];
};

/** Points per aliased cabinsNear request. */
const POINTS_PER_REQUEST = 10;

/** Name of DNT's list of its signature routes. */
const SIGNATURE_LIST = "SignaTUR - Norges ypperste langturer";

/** Upper bound for client-side filtering after a *Near query or a duration limit. */
const OVERFETCH = 50;

export class UtnoClient implements TrailSource {
  constructor(private readonly http = new PoliteHttp()) {}

  async gql(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this.http.json<GqlResponse>(config.utno.graphqlUrl, {
      method: "POST",
      body: { query, variables },
      ttlMs: config.utno.ttlMs,
    });
    if (res.errors?.length) throw new Error(`ut.no GraphQL error: ${res.errors.map((e) => e.message).join("; ")}`);
    return res.data ?? {};
  }

  async searchCabins(q: CabinQuery): Promise<Paged<Cabin>> {
    const limit = q.limit ?? 20;
    const levels = q.serviceLevels?.flatMap((l) => SERVICE_LEVELS[l]);

    if (q.near) {
      // cabinsNear takes no filters, so filter its (distance-sorted) result here.
      const data = await this.gql(Q.CABINS_NEAR, {
        input: { coordinates: [q.near.lon, q.near.lat], maxDistance: Math.round(q.near.radiusKm * 1000) },
      });
      const rows = Array.isArray(data.cabinsNear) ? data.cabinsNear.filter(isObj) : [];
      const text = q.text?.toLowerCase();
      const nodes = rows
        .map((r) => r.cabin)
        .filter(isObj)
        .filter(
          (c) =>
            (!text || (str(c, "name") ?? "").toLowerCase().includes(text)) &&
            (!levels?.length || levels.includes(str(c, "serviceLevel") ?? "UNKNOWN")) &&
            (!q.areaId || areaIds(c).includes(q.areaId)),
        );
      return { items: nodes.slice(0, limit).map(normalizeCabin), total: nodes.length };
    }

    const and: Raw[] = [];
    if (q.text) and.push({ name: iLike(q.text) });
    if (levels?.length) and.push({ serviceLevel: { in: levels } });
    if (q.areaId) and.push({ areas: { id: { eq: Number(q.areaId) } } });
    const data = await this.gql(Q.FIND_CABINS, {
      paging: { first: limit },
      filter: and.length ? { and } : {},
      sorting: [{ field: "name", direction: "ASC" }],
    });
    const { nodes, total } = unwrapList(data.cabins);
    return { items: nodes.map(normalizeCabin), total };
  }

  /** Runs a by-id query, mapping ut.no's "Unable to find" error to undefined. */
  private async byId(query: string, field: string, id: string): Promise<Raw | undefined> {
    if (!/^\d+$/.test(id)) return undefined;
    try {
      const node = (await this.gql(query, { id: Number(id) }))[field];
      return isObj(node) ? node : undefined;
    } catch (e) {
      if (e instanceof Error && /unable to find/i.test(e.message)) return undefined;
      throw e;
    }
  }

  async getCabin(id: string): Promise<Cabin | undefined> {
    const node = await this.byId(Q.GET_CABIN, "cabin", id);
    return node && normalizeCabin(node);
  }

  async searchTrips(q: TripQuery): Promise<Paged<Trip>> {
    const limit = q.limit ?? 20;
    const gradings = q.gradings?.flatMap((g) => GRADINGS[g]);
    // Duration is split over days/hours/minutes, so filter on the normalised value.
    const fitsDuration = (t: Trip) =>
      !q.maxDurationHours || (t.durationDays === undefined && t.durationHours !== undefined && t.durationHours <= q.maxDurationHours);

    let nodes: Raw[];
    let total: number | undefined;
    if (q.near) {
      const data = await this.gql(Q.TRIPS_NEAR, {
        input: { coordinates: [q.near.lon, q.near.lat], maxDistance: Math.round(q.near.radiusKm * 1000) },
      });
      const rows = Array.isArray(data.tripsNear) ? data.tripsNear.filter(isObj) : [];
      const text = q.text?.toLowerCase();
      nodes = rows
        .map((r) => r.trip)
        .filter(isObj)
        .filter(
          (t) =>
            (!text || (str(t, "name") ?? "").toLowerCase().includes(text)) &&
            (!gradings?.length || gradings.includes(str(t, "grading") ?? "")) &&
            (!q.areaId || areaIds(t).includes(q.areaId)),
        );
    } else {
      const and: Raw[] = [];
      if (q.text) and.push({ name: iLike(q.text) });
      if (gradings?.length) and.push({ grading: { in: gradings } });
      if (q.areaId) and.push({ areas: { id: { eq: Number(q.areaId) } } });
      const data = await this.gql(Q.FIND_TRIPS, {
        paging: { first: q.maxDurationHours ? OVERFETCH : limit },
        filter: and.length ? { and } : {},
        sorting: [{ field: "name", direction: "ASC" }],
      });
      ({ nodes, total } = unwrapList(data.trips));
    }
    const trips = nodes.map(normalizeTrip).filter(fitsDuration);
    return { items: trips.slice(0, limit), total: q.maxDurationHours || q.near ? trips.length : total };
  }

  async getTrip(id: string): Promise<Trip | undefined> {
    const node = await this.byId(Q.GET_TRIP, "trip", id);
    return node && normalizeTrip(node);
  }

  async searchAreas(text: string, limit = 20): Promise<Paged<Area>> {
    const data = await this.gql(Q.FIND_AREAS, {
      paging: { first: limit },
      filter: { name: iLike(text) },
      sorting: [{ field: "name", direction: "ASC" }],
    });
    const { nodes, total } = unwrapList(data.areas);
    return { items: nodes.map(normalizeArea), total };
  }

  async getRoutes(ids: string[]): Promise<Route[]> {
    const numeric = [...new Set(ids)].filter((id) => /^\d+$/.test(id)).map(Number);
    if (!numeric.length) return [];
    const data = await this.gql(Q.GET_ROUTES, {
      paging: { first: numeric.length },
      filter: { id: { in: numeric } },
      sorting: [{ field: "id", direction: "ASC" }],
    });
    return unwrapList(data.routes).nodes.map(normalizeRoute);
  }

  async routesNearPoints(points: LatLon[], radiusKm: number): Promise<Route[][]> {
    const out: Route[][] = [];
    for (let i = 0; i < points.length; i += POINTS_PER_REQUEST) {
      const batch = points.slice(i, i + POINTS_PER_REQUEST);
      const vars = Object.fromEntries(
        batch.map((p, j) => [`p${j}`, { coordinates: [p.lon, p.lat], maxDistance: Math.round(radiusKm * 1000) }]),
      );
      const data = await this.gql(Q.routesNearPoints(batch.length), vars);
      for (let j = 0; j < batch.length; j++) {
        const rows = data[`p${j}`];
        out.push((Array.isArray(rows) ? rows.filter(isObj) : []).filter((r) => isObj(r.route)).map((r) => normalizeRoute(r.route as Raw)));
      }
    }
    return out;
  }

  async cabinsNearPoints(points: LatLon[], radiusKm: number): Promise<{ cabin: Cabin; distanceM: number }[][]> {
    const out: { cabin: Cabin; distanceM: number }[][] = [];
    for (let i = 0; i < points.length; i += POINTS_PER_REQUEST) {
      const batch = points.slice(i, i + POINTS_PER_REQUEST);
      const vars = Object.fromEntries(
        batch.map((p, j) => [`p${j}`, { coordinates: [p.lon, p.lat], maxDistance: Math.round(radiusKm * 1000) }]),
      );
      const data = await this.gql(Q.cabinsNearPoints(batch.length), vars);
      for (let j = 0; j < batch.length; j++) {
        const rows = data[`p${j}`];
        out.push(
          (Array.isArray(rows) ? rows.filter(isObj) : [])
            .filter((r) => isObj(r.cabin))
            .map((r) => ({ cabin: normalizeCabin(r.cabin as Raw), distanceM: Number(r.distance) || 0 })),
        );
      }
    }
    return out;
  }

  async signatureRoutes(): Promise<Trip[]> {
    const data = await this.gql(Q.SIGNATURE_ROUTES, { filter: { name: { eq: SIGNATURE_LIST } } });
    const [list] = unwrapList(data.lists).nodes;
    const items = list && Array.isArray(list.listItems) ? list.listItems.filter(isObj) : [];
    const ids = items.map((i) => i.entity).filter((e): e is Raw => isObj(e) && e.__typename === "Trip").map((e) => Number(e.id));
    if (!ids.length) return [];
    // List entries leave cabinIds empty, so fetch the trips themselves (in list order).
    const trips = await this.gql(Q.FIND_TRIPS, { paging: { first: ids.length }, filter: { id: { in: ids } }, sorting: [] });
    const byId = new Map(unwrapList(trips.trips).nodes.map((n) => [Number(n.id), normalizeTrip(n)]));
    return ids.map((id) => byId.get(id)).filter((t): t is Trip => !!t);
  }
}
