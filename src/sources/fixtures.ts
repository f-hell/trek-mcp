import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dateRange } from "../dates.js";
import type { Area, BookingInfo, Cabin, LatLon, Route, NightAvailability, Paged, Trip } from "../domain.js";
import { haversineKm } from "../geo.js";
import type { BookingSource, CabinQuery, TrailSource, TripQuery } from "./types.js";

// Offline sources backed by data/fixtures. The data is ILLUSTRATIVE ONLY
// (approximate coordinates, made-up ids and availability) and exists so the
// MCP server can be exercised offline. Enable with TREK_MCP_FIXTURES=1.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = <T>(name: string): T => JSON.parse(readFileSync(join(root, "data", "fixtures", name), "utf8")) as T;

const matches = (text: string | undefined, ...fields: (string | undefined)[]) =>
  !text || fields.some((f) => f?.toLowerCase().includes(text.toLowerCase()));

export class FixtureTrailSource implements TrailSource {
  private cabins = load<Cabin[]>("cabins.json");
  private trips = load<Trip[]>("trips.json");
  private areas = load<Area[]>("areas.json");
  private routes = load<Route[]>("routes.json");
  private signature = load<Trip[]>("signature-routes.json");

  async searchCabins(q: CabinQuery): Promise<Paged<Cabin>> {
    const items = this.cabins.filter(
      (c) =>
        matches(q.text, c.name, c.description) &&
        (!q.areaId || c.area?.id === q.areaId) &&
        (!q.serviceLevels?.length || q.serviceLevels.includes(c.serviceLevel)) &&
        (!q.near || (c.location && haversineKm(q.near, c.location) <= q.near.radiusKm)),
    );
    return { items: items.slice(0, q.limit ?? 20), total: items.length };
  }

  async getCabin(id: string) {
    return this.cabins.find((c) => c.id === id);
  }

  async searchTrips(q: TripQuery): Promise<Paged<Trip>> {
    const items = this.trips.filter(
      (t) =>
        matches(q.text, t.name, t.description) &&
        (!q.areaId || t.area?.id === q.areaId) &&
        (!q.gradings?.length || q.gradings.includes(t.grading)) &&
        (!q.maxDurationHours || (t.durationHours ?? Infinity) <= q.maxDurationHours) &&
        (!q.near || (t.start && haversineKm(q.near, t.start) <= q.near.radiusKm)),
    );
    return { items: items.slice(0, q.limit ?? 20), total: items.length };
  }

  async getTrip(id: string) {
    return this.trips.find((t) => t.id === id);
  }

  async searchAreas(text: string, limit = 20): Promise<Paged<Area>> {
    const items = this.areas.filter((a) => matches(text, a.name, a.description));
    return { items: items.slice(0, limit), total: items.length };
  }

  async getRoutes(ids: string[]): Promise<Route[]> {
    return this.routes.filter((r) => ids.includes(r.id));
  }

  async routesNearPoints(points: LatLon[], radiusKm: number): Promise<Route[][]> {
    // Distance to the line's endpoints stands in for distance to the line.
    return points.map((p) =>
      this.routes.filter((r) => [r.start, r.end].some((e) => e && haversineKm(p, e) <= radiusKm)),
    );
  }

  async cabinsNearPoints(points: LatLon[], radiusKm: number) {
    return points.map((p) =>
      this.cabins
        .filter((c) => c.location)
        .map((cabin) => ({ cabin, distanceM: Math.round(haversineKm(p, cabin.location!) * 1000) }))
        .filter((x) => x.distanceM <= radiusKm * 1000)
        .sort((a, b) => a.distanceM - b.distanceM),
    );
  }

  async signatureRoutes(): Promise<Trip[]> {
    return this.signature;
  }
}

/** Deterministic fake availability so results are stable across runs. */
export class FixtureBookingSource implements BookingSource {
  bookingUrl(bookingId: string) {
    return `https://hyttebestilling.dnt.no/hytte/${bookingId}`;
  }

  async getBookingInfo(): Promise<BookingInfo | undefined> {
    return { maxNights: 4, cancellationDaysBefore: 4 };
  }

  async getAvailability(bookingId: string, from: string, to: string): Promise<NightAvailability[]> {
    return dateRange(from, to).map((date) => {
      let h = 0;
      for (const ch of bookingId + date) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const beds = h % 13; // 0..12
      return { date, status: beds === 0 ? "full" : "available", bedsAvailable: beds };
    });
  }
}
