import type { Area, BookingInfo, Cabin, Grading, LatLon, NightAvailability, Paged, ServiceLevel, Trip } from "../domain.js";

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
}

/** Cabin availability (hyttebestilling.dnt.no). */
export interface BookingSource {
  /** Nights from `from` (inclusive) to `to` (exclusive), ISO dates. */
  getAvailability(bookingId: string, from: string, to: string): Promise<NightAvailability[]>;
  /** Notices and booking limits from the cabin's booking page. */
  getBookingInfo(bookingId: string): Promise<BookingInfo | undefined>;
  bookingUrl(bookingId: string): string;
}
