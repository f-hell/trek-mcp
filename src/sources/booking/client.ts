import { config } from "../../config.js";
import { dateRange } from "../../dates.js";
import type { NightAvailability } from "../../domain.js";
import { PoliteHttp } from "../../http.js";
import type { BookingSource } from "../types.js";
import { normalizeAvailability } from "./normalize.js";

/**
 * hyttebestilling.dnt.no client. Read-only: it checks availability and links
 * to the booking page; it never creates bookings.
 *
 * The availability endpoint is configured through BOOKING_AVAILABILITY_PATH,
 * a template such as `/api/availability?cabinId={id}&from={from}&to={to}`.
 * Find the real one with `npm run recon -- https://hyttebestilling.dnt.no/hytte/101265`.
 */
export class HyttebestillingClient implements BookingSource {
  constructor(
    private readonly http = new PoliteHttp(),
    private readonly pathTemplate = config.booking.availabilityPath,
  ) {}

  bookingUrl(bookingId: string): string {
    return `${config.booking.baseUrl}/hytte/${bookingId}`;
  }

  async getAvailability(bookingId: string, from: string, to: string): Promise<NightAvailability[]> {
    if (!this.pathTemplate) {
      throw new Error(
        "Booking availability endpoint not configured. Set BOOKING_AVAILABILITY_PATH after running " +
          "`npm run recon -- https://hyttebestilling.dnt.no/hytte/<id>` (see docs/RECON.md).",
      );
    }
    const path = this.pathTemplate
      .replaceAll("{id}", encodeURIComponent(bookingId))
      .replaceAll("{from}", from)
      .replaceAll("{to}", to);
    const payload = await this.http.json<unknown>(new URL(path, config.booking.baseUrl).toString(), {
      ttlMs: config.booking.ttlMs,
    });
    const wanted = new Set(dateRange(from, to));
    return normalizeAvailability(payload).filter((n) => wanted.has(n.date));
  }
}
