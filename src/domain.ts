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
  description?: string;
  url: string;
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
}

export interface Paged<T> {
  items: T[];
  total?: number;
}
