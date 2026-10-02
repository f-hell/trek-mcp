import type { Area, BookingInfo, Cabin, Grading, LatLon, NightAvailability, Paged, Route, ServiceLevel, Trip } from "../domain.js";
import type { ProductKind } from "./booking/normalize.js";

export interface NearQuery {
  near?: LatLon & { radiusKm: number };
}

export interface CabinQuery extends NearQuery {
  text?: string;
  areaId?: string;
  serviceLevels?: ServiceLevel[];
  limit?: number;
}

export interface TripQuery extends NearQuery {
  text?: string;
  areaId?: string;
  gradings?: Grading[];
  maxDurationHours?: number;
  limit?: number;
}

/** Trails, cabins and areas (ut.no). */
export interface TrailSource {
  searchCabins(q: CabinQuery): Promise<Paged<Cabin>>;
  getCabin(id: string): Promise<Cabin | undefined>;
  searchTrips(q: TripQuery): Promise<Paged<Trip>>;
  getTrip(id: string): Promise<Trip | undefined>;
  searchAreas(text: string, limit?: number): Promise<Paged<Area>>;
  /** Marked routes by id (missing ids are skipped). */
  getRoutes(ids: string[]): Promise<Route[]>;
  /** For each point, marked routes passing within `radiusKm` (summary fields, no descriptions). */
  routesNearPoints(points: LatLon[], radiusKm: number): Promise<Route[][]>;
  /** For each point, cabins within `radiusKm`, nearest first (with distance in metres). */
  cabinsNearPoints(points: LatLon[], radiusKm: number): Promise<{ cabin: Cabin; distanceM: number }[][]>;
  /** DNT's signature long-distance routes (SignaTUR), as trips. */
  signatureRoutes(): Promise<Trip[]>;
}

/** Cabin availability (hyttebestilling.dnt.no). */
export interface BookingSource {
  /** Nights from `from` (inclusive) to `to` (exclusive), ISO dates; `kind` picks one cabin on a shared calendar. */
  getAvailability(bookingId: string, from: string, to: string, kind?: ProductKind): Promise<NightAvailability[]>;
  /** Notices and booking limits from the cabin's booking page. */
  getBookingInfo(bookingId: string, kind?: ProductKind): Promise<BookingInfo | undefined>;
  bookingUrl(bookingId: string): string;
}
