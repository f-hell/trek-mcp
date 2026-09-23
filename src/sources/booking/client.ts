import { config } from "../../config.js";
import { addDays, dateRange } from "../../dates.js";
import type { NightAvailability } from "../../domain.js";
import { PoliteHttp } from "../../http.js";
import type { BookingSource } from "../types.js";
import { normalizeAvailability } from "./normalize.js";

/** Guards against a response that never advances. */
const MAX_WINDOWS = 4;

/**
 * hyttebestilling.dnt.no client. Read-only: it checks availability and links
 * to the booking page; it never creates bookings.
 *
 * The availability path is a template with {id}, {from} and {to}. The default
 * is the site's availability-calendar route. It answers for [from, to), but
 * its window is fixed by the site (e.g. up to 31 December or 30 June), so a
 * long range can take more than one request.
 */
export class HyttebestillingClient implements BookingSource {
  constructor(
    private readonly http = new PoliteHttp(),
    private readonly pathTemplate = config.booking.availabilityPath,
  ) {}

  bookingUrl(bookingId: string): string {
    return `${config.booking.baseUrl}/hytte/${bookingId}`;
  }

  /** Nights in [from, to) that the response actually covers. */
  private async window(bookingId: string, from: string, to: string): Promise<NightAvailability[]> {
    const path = this.pathTemplate
      .replaceAll("{id}", encodeURIComponent(bookingId))
      .replaceAll("{from}", from)
      .replaceAll("{to}", to);
    const payload = await this.http.json<unknown>(new URL(path, config.booking.baseUrl).toString(), {
      ttlMs: config.booking.ttlMs,
    });
    return normalizeAvailability(payload).filter((n) => n.date >= from && n.date < to);
  }

  async getAvailability(bookingId: string, from: string, to: string): Promise<NightAvailability[]> {
    const wanted = dateRange(from, to);
    if (!wanted.length) return [];
    const last = wanted[wanted.length - 1]!;
    const byDate = new Map<string, NightAvailability>();
    let cursor = from;
    for (let i = 0; i < MAX_WINDOWS && cursor <= last; i++) {
      const nights = await this.window(bookingId, cursor, to);
      for (const n of nights) byDate.set(n.date, n);
      const end = nights.at(-1)?.date;
      if (!end || end < cursor) break;
      cursor = addDays(end, 1);
    }
    return wanted.map((date) => byDate.get(date) ?? { date, status: "unknown" });
  }
}
