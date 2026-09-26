import type { BookingInfo } from "../../domain.js";
import { bool, htmlToText, isObj, num, pick, type Raw, str } from "../normalize.js";

// Reads the cabin data that hyttebestilling.dnt.no embeds in its cabin page
// (/hytte/<id>). The page is a Next.js app: the data is a React Server
// Components stream pushed as `self.__next_f.push([1, "<chunk>"])` script
// tags, where the cabin is a plain JSON object:
//
//   { "ut_id": 101265, "title": "Skarvheim", "status_message": null,
//     "suitable_for_dogs": false, ...,
//     "web_bookings": { "closed_from": null, "closed_to": null, "max_length_of_stay": 4,
//                       "min_length_of_stay": 0, "days_before_cancellation": 4, ... } }
//
// Site-wide banners ("Status hytteslipp for overnatting 2026: ...") appear as
// other `status_message` values in the same stream.

/** Concatenated RSC stream from a Next.js page. */
export function rscPayload(html: string): string {
  const out: string[] = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      out.push(JSON.parse(m[1]!) as string);
    } catch {
      // skip malformed chunk
    }
  }
  return out.join("");
}

/** Parses the JSON object that starts at `start` (a "{"), respecting strings. */
export function jsonObjectAt(s: string, start: number): Raw | undefined {
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        const v: unknown = JSON.parse(s.slice(start, i + 1));
        return isObj(v) ? v : undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

const isoDate = (v: string | undefined) => v?.slice(0, 10);

export function normalizeCabinPage(html: string): BookingInfo | undefined {
  const s = rscPayload(html);
  // The cabin object is the one carrying web_bookings.
  let cabin: Raw | undefined;
  for (const m of s.matchAll(/\{"ut_id":/g)) {
    const o = jsonObjectAt(s, m.index);
    if (o && "web_bookings" in o) {
      cabin = o;
      break;
    }
  }
  if (!cabin) return undefined;

  const statusMessage = htmlToText(str(cabin, "status_message"));
  const siteNotices = [
    ...new Set(
      [...s.matchAll(/"status_message":("(?:[^"\\]|\\.)*")/g)]
        .map((m) => htmlToText(JSON.parse(m[1]!) as string))
        .filter((t): t is string => !!t && t !== statusMessage),
    ),
  ];
  const wb = pick(cabin, "web_bookings");
  const web = isObj(wb) ? wb : {};
  const closedFrom = isoDate(str(web, "closed_from"));
  const closedTo = isoDate(str(web, "closed_to"));
  const minNights = num(web, "min_length_of_stay");
  return {
    statusMessage,
    siteNotices: siteNotices.length ? siteNotices : undefined,
    bookingClosed: closedFrom || closedTo ? { from: closedFrom, to: closedTo } : undefined,
    minNights: minNights ? minNights : undefined,
    maxNights: num(web, "max_length_of_stay") || undefined,
    cancellationDaysBefore: num(web, "days_before_cancellation"),
    dogsAllowed: bool(cabin, "suitable_for_dogs"),
  };
}
