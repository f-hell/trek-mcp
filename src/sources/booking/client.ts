import { config } from "../../config.js";
import { addDays, dateRange, toIsoDate } from "../../dates.js";
import type { BookingInfo, NightAvailability } from "../../domain.js";
import { PoliteHttp } from "../../http.js";
import type { BookingSource } from "../types.js";
import { normalizeAvailability, type ProductKind, productNotes } from "./normalize.js";
import { normalizeCabinPage } from "./page.js";

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
    private readonly parsePages = config.booking.parsePages,
  ) {}

  bookingUrl(bookingId: string): string {
    return `${config.booking.baseUrl}/hytte/${bookingId}`;
  }

  /**
   * Booking conditions from the availability calendar's product descriptions.
   * With `parsePages` (off by default) it also reads notices and limits from
   * the cabin's booking page; only parsed fields are cached.
   */
  async getBookingInfo(bookingId: string, kind?: ProductKind): Promise<BookingInfo | undefined> {
    const info = this.parsePages
      ? await this.http.text(this.bookingUrl(encodeURIComponent(bookingId)), normalizeCabinPage, {
          ttlMs: config.booking.infoTtlMs,
        })
      : undefined;
    const today = toIsoDate(new Date());
    const calendar = await this.http.json<unknown>(this.calendarUrl(bookingId, today, addDays(today, 1)), {
      ttlMs: config.booking.infoTtlMs,
    });
    const conditions = productNotes(calendar, kind);
    return info || conditions.length ? { ...info, bookingConditions: conditions.length ? conditions : undefined } : undefined;
  }

  private calendarUrl(bookingId: string, from: string, to: string): string {
    const path = this.pathTemplate
      .replaceAll("{id}", encodeURIComponent(bookingId))
      .replaceAll("{from}", from)
      .replaceAll("{to}", to);
    return new URL(path, config.booking.baseUrl).toString();
  }

  /** Nights in [from, to) that the response actually covers. */
  private async window(bookingId: string, from: string, to: string, kind?: ProductKind): Promise<NightAvailability[]> {
    const payload = await this.http.json<unknown>(this.calendarUrl(bookingId, from, to), { ttlMs: config.booking.ttlMs });
    return normalizeAvailability(payload, kind).filter((n) => n.date >= from && n.date < to);
  }

  async getAvailability(bookingId: string, from: string, to: string, kind?: ProductKind): Promise<NightAvailability[]> {
    const wanted = dateRange(from, to);
    if (!wanted.length) return [];
    const last = wanted[wanted.length - 1]!;
    const byDate = new Map<string, NightAvailability>();
    let cursor = from;
    for (let i = 0; i < MAX_WINDOWS && cursor <= last; i++) {
      const nights = await this.window(bookingId, cursor, to, kind);
      for (const n of nights) byDate.set(n.date, n);
      const end = nights.at(-1)?.date;
      if (!end || end < cursor) break;
      cursor = addDays(end, 1);
    }
    return wanted.map((date) => byDate.get(date) ?? { date, status: "unknown" });
  }
}
