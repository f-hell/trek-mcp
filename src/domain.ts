// Source-agnostic domain model. Adapters in src/sources/* map raw API data
// into these shapes so tools and planning logic never depend on a source's
// wire format.

export interface LatLon {
  lat: number;
  lon: number;
}

export type ServiceLevel =
  | "staffed" // betjent
  | "self-service" // selvbetjent
  | "no-service" // ubetjent
  | "emergency" // nødbu
  | "closed"
  | "unknown";

export interface CabinBeds {
  total?: number;
  staffed?: number;
  selfService?: number;
  noService?: number;
  winter?: number;
}

/** A period with a given service level, e.g. staffed 20 June to 10 September. */
export interface CabinOpening {
  serviceLevel: ServiceLevel;
  /** ISO date; the source may report a past year for recurring seasons. */
  from?: string;
  to?: string;
  openAllYear: boolean;
  beds?: number;
  requiresDntKey?: boolean;
}

export interface Cabin {
  /** ut.no id */
  id: string;
  name: string;
  serviceLevel: ServiceLevel;
  dntCabin: boolean;
  requiresDntKey?: boolean;
  beds: CabinBeds;
  location?: LatLon & { elevationM?: number };
  area?: { id: string; name: string };
  openings?: CabinOpening[];
  /** Plain text from ut.no, including the cabin's own house and booking rules */
  description?: string;
  /** How to get there in summer / winter (transport, parking, marked trails) */
  access?: { summer?: string; winter?: string };
  /** Lines from the description about booking, drop-in, arrival times and beds */
  bookingNotes?: string[];
  url: string;
  /** Marked routes (see Route) that start or end at this cabin */
  routeIds?: string[];
  /** hyttebestilling.dnt.no id, when the cabin can be booked there */
  bookingId?: string;
  /** Where to book: hyttebestilling or the cabin's own site */
  bookingUrl?: string;
  /** Booking is required (no drop-in) */
  bookingOnly?: boolean;
}

export type Grading = "easy" | "moderate" | "tough" | "expert" | "unknown";

export interface Trip {
  id: string;
  name: string;
  grading: Grading;
  distanceKm?: number;
  /** Set for multi-day trips; durationHours is then left out. */
  durationDays?: number;
  durationHours?: number;
  ascentM?: number;
  descentM?: number;
  start?: LatLon;
  end?: LatLon;
  /** Recommended months, 1-12 */
  seasonMonths?: number[];
  /** e.g. "hiking", "ski_touring" */
  activity?: string;
  area?: { id: string; name: string };
  cabinIds?: string[];
  description?: string;
  url: string;
}

/** One direction of a marked route. */
export interface RouteDirection {
  grading: Grading;
  durationHours?: number;
  durationDays?: number;
  ascentM?: number;
  descentM?: number;
  description?: string;
}

/**
 * A DNT marked route (rutebeskrivelse) between two places, usually cabins.
 * `forward` is from → to; `reverse` is to → from.
 */
export interface Route {
  id: string;
  name: string;
  /** DNT route code, e.g. "jot2" */
  code?: string;
  /** "foot" (summer, T-marked) or "ski" (winter, marked with poles) */
  type?: string;
  from?: string;
  to?: string;
  via?: string;
  distanceKm?: number;
  start?: LatLon;
  end?: LatLon;
  maxElevationM?: number;
  forward: RouteDirection;
  reverse: RouteDirection;
  /** When the winter route is marked, e.g. "13.mars-12.april 2026" */
  winterMarking?: string;
  notes?: string;
  url: string;
}

export interface Area {
  id: string;
  name: string;
  description?: string;
  url: string;
}

export type NightStatus = "available" | "full" | "closed" | "unknown";

export interface NightAvailability {
  /** ISO date (YYYY-MM-DD) of the night, i.e. check-in date */
  date: string;
  status: NightStatus;
  /** bookable beds left, if the source reports it (excludes tent pitches and extra mattresses) */
  bedsAvailable?: number;
  /** What is left per bookable category, e.g. "Seng i 2-sengsrom": 4 */
  options?: { name: string; available: number }[];
  /** Set when the sources disagree about this night */
  note?: string;
  /** Beds the cabin sells online in total, when the source lists them bed by bed */
  bookableBeds?: number;
  /**
   * Beds that can't be pre-booked (first come, first served): the cabin's beds
   * for the season minus bookableBeds. No-shows after the claim deadline add to these.
   */
  dropInBeds?: number;
}

/** What hyttebestilling.dnt.no says about a cabin, beyond nightly availability. */
export interface BookingInfo {
  /** Notice shown on the cabin's booking page */
  statusMessage?: string;
  /** Site-wide banners, e.g. about the yearly booking release ("hytteslipp") */
  siteNotices?: string[];
  /** Online booking is closed in this period (ISO dates) */
  bookingClosed?: { from?: string; to?: string };
  minNights?: number;
  maxNights?: number;
  /** Free cancellation up to this many days before arrival */
  cancellationDaysBefore?: number;
  dogsAllowed?: boolean;
  /** Conditions and inclusions from the bookable products, e.g. membership or DNT key required */
  bookingConditions?: string[];
}

export interface Paged<T> {
  items: T[];
  total?: number;
}
