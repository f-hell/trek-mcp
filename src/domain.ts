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
  description?: string;
  url: string;
  /** hyttebestilling.dnt.no id, when the cabin can be booked there */
  bookingId?: string;
}

export type Grading = "easy" | "moderate" | "tough" | "expert" | "unknown";

export interface Trip {
  id: string;
  name: string;
  grading: Grading;
  distanceKm?: number;
  durationHours?: number;
  ascentM?: number;
  descentM?: number;
  start?: LatLon;
  end?: LatLon;
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
  /** bookable beds left, if the source reports it */
  bedsAvailable?: number;
}

export interface Paged<T> {
  items: T[];
  total?: number;
}
