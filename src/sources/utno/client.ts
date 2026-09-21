import { config } from "../../config.js";
import type { Area, Cabin, Paged, Trip } from "../../domain.js";
import { PoliteHttp } from "../../http.js";
import { isObj, type Raw } from "../normalize.js";
import type { CabinQuery, TrailSource, TripQuery } from "../types.js";
import { normalizeArea, normalizeCabin, normalizeTrip, unwrapList } from "./normalize.js";
import * as Q from "./queries.js";

interface GqlResponse {
  data?: Record<string, unknown>;
  errors?: { message: string }[];
}

export class UtnoClient implements TrailSource {
  constructor(private readonly http = new PoliteHttp()) {}

  async gql(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this.http.json<GqlResponse>(config.utno.graphqlUrl, {
      method: "POST",
      body: { query, variables },
      ttlMs: config.utno.ttlMs,
    });
    if (res.errors?.length) {
      throw new Error(
        `ut.no GraphQL error: ${res.errors.map((e) => e.message).join("; ")}. ` +
          "The queries in src/sources/utno/queries.ts are unverified; run `npm run recon` to capture the real ones.",
      );
    }
    return res.data ?? {};
  }

  private first(data: Record<string, unknown>): unknown {
    return Object.values(data)[0];
  }

  async searchCabins(q: CabinQuery): Promise<Paged<Cabin>> {
    const data = await this.gql(Q.FIND_CABINS, {
      input: {
        search: q.text,
        areaId: q.areaId,
        serviceLevels: q.serviceLevels,
        near: q.near && { lat: q.near.lat, lon: q.near.lon, radiusMeters: q.near.radiusKm * 1000 },
        pageSize: q.limit ?? 20,
      },
    });
    const { nodes, total } = unwrapList(this.first(data));
    return { items: nodes.map(normalizeCabin), total };
  }

  async getCabin(id: string): Promise<Cabin | undefined> {
    const node = this.first(await this.gql(Q.GET_CABIN, { id: Number(id) }));
    return isObj(node) ? normalizeCabin(node as Raw) : undefined;
  }

  async searchTrips(q: TripQuery): Promise<Paged<Trip>> {
    const data = await this.gql(Q.FIND_TRIPS, {
      input: {
        search: q.text,
        areaId: q.areaId,
        gradings: q.gradings,
        maxDurationMinutes: q.maxDurationHours && q.maxDurationHours * 60,
        near: q.near && { lat: q.near.lat, lon: q.near.lon, radiusMeters: q.near.radiusKm * 1000 },
        pageSize: q.limit ?? 20,
      },
    });
    const { nodes, total } = unwrapList(this.first(data));
    return { items: nodes.map(normalizeTrip), total };
  }

  async getTrip(id: string): Promise<Trip | undefined> {
    const node = this.first(await this.gql(Q.GET_TRIP, { id: Number(id) }));
    return isObj(node) ? normalizeTrip(node as Raw) : undefined;
  }

  async searchAreas(text: string, limit = 20): Promise<Paged<Area>> {
    const data = await this.gql(Q.FIND_AREAS, { input: { search: text, pageSize: limit } });
    const { nodes, total } = unwrapList(this.first(data));
    return { items: nodes.map(normalizeArea), total };
  }
}
