import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeAvailability } from "../src/sources/booking/normalize.js";
import { htmlToText } from "../src/sources/normalize.js";
import {
  bookingIdFromUrl,
  decodePolyline,
  grading,
  normalizeArea,
  normalizeCabin,
  normalizeTrip,
  serviceLevel,
  unwrapList,
} from "../src/sources/utno/normalize.js";

// Real responses recorded with `npm run fixtures:record`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fixture = (name: string): any => JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));

describe("ut.no normalisers", () => {
  it("maps a real cabin", () => {
    const c = normalizeCabin(fixture("utno/cabin-101265.json").data.cabin);
    expect(c).toMatchObject({
      id: "101265",
      name: "Skarvheim",
      serviceLevel: "self-service",
      dntCabin: true,
      requiresDntKey: true,
      beds: { selfService: 9 },
      location: { lat: 61.02224, lon: 8.04158, elevationM: 1029 },
      area: { id: "1232", name: "Skarvheimen" },
      url: "https://ut.no/hytte/101265",
      bookingId: "101265",
    });
    expect(c.openings).toContainEqual(expect.objectContaining({ serviceLevel: "closed", from: "2026-10-15", to: "2027-02-15" }));
  });

  it("keeps the cabin's own texts as plain text, with booking notes pulled out", () => {
    const c = normalizeCabin(fixture("utno/cabin-101265.json").data.cabin);
    expect(c.description).not.toMatch(/<\w+/);
    expect(c.description).toContain("- Antall soveplasser totalt: 9");
    expect(c.bookingNotes).toEqual(
      expect.arrayContaining(["- Antall senger for drop-in: 3", expect.stringMatching(/før kl\. 19\.00/)]),
    );
    expect(c.access?.summer).toContain("Breistølen");
    expect(c.access?.winter).toBeDefined();
  });

  it("takes the booking id from bookingUrl, not the ut.no id", () => {
    const { nodes, total } = unwrapList(fixture("utno/cabins-gjende.json").data.cabins);
    const byName = Object.fromEntries(nodes.map(normalizeCabin).map((c) => [c.name, c]));
    expect(total).toBe(4);
    expect(byName["Gjendebu Selvbetjent"]).toMatchObject({ id: "10908403", bookingId: "10581", area: { name: "Jotunheimen" } });
    expect(byName["Gjendesheim"]).toMatchObject({ serviceLevel: "staffed", bookingId: "10604" });
    // A rental cabin whose bookingUrl points to inatur.no
    const rental = Object.values(byName).find((c) => c.name.startsWith("Gjendeosbue"));
    expect(rental).toMatchObject({ bookingId: undefined, bookingUrl: expect.stringContaining("inatur.no") });
  });

  it("maps cabinsNear rows", () => {
    const rows = fixture("utno/cabins-near-skarvheim.json").data.cabinsNear as { cabin: never }[];
    expect(rows.map((r) => normalizeCabin(r.cabin).name)).toEqual(["Skarvheim", "Breistølen Fjellstue", "Bjordalsbu"]);
  });

  it("maps a real trip, using the start as the end of a round trip", () => {
    const t = normalizeTrip(fixture("utno/trip-116978.json").data.trip);
    expect(t).toMatchObject({
      id: "116978",
      grading: "expert",
      distanceKm: 24.3,
      durationHours: 7.5,
      ascentM: 833,
      seasonMonths: [6, 7, 8, 9],
      activity: "hiking",
      area: { id: "1232", name: "Skarvheimen" },
      start: { lat: 61.008291, lon: 8.107338 },
      end: { lat: 61.008291, lon: 8.107338 },
      url: "https://ut.no/tur/116978",
    });
    expect(t.durationDays).toBeUndefined();
  });

  it("reports multi-day trips in days", () => {
    expect(normalizeTrip({ id: 1, durationDays: 3, durationHours: 0 })).toMatchObject({ durationDays: 3, durationHours: undefined });
  });

  it("maps areas", () => {
    const { nodes } = unwrapList(fixture("utno/areas-jotunheimen.json").data.areas);
    expect(nodes.map(normalizeArea)[0]).toMatchObject({ name: "Jotunheimen", url: expect.stringMatching(/^https:\/\/ut\.no\/omrade\/\d+$/) });
  });

  it("maps the schema's enums", () => {
    expect(serviceLevel("SELF_SERVICE")).toBe("self-service");
    expect(serviceLevel("NO_SERVICE_NO_BEDS")).toBe("no-service");
    expect(serviceLevel("EMERGENCY_SHELTER")).toBe("emergency");
    expect(serviceLevel("RENTAL")).toBe("unknown");
    expect(grading("HIGHLY_ACCESSIBLE")).toBe("easy");
    expect(grading("VERY_TOUGH")).toBe("expert");
  });

  it("decodes encoded polylines", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      { lat: 38.5, lon: -120.2 },
      { lat: 40.7, lon: -120.95 },
      { lat: 43.252, lon: -126.453 },
    ]);
  });

  it("parses booking ids only from hyttebestilling urls", () => {
    expect(bookingIdFromUrl("https://www.inatur.no/tilbud/6088019edbe3070003c3f31f")).toBeUndefined();
    expect(bookingIdFromUrl("https://hyttebestilling.dnt.no/hytte/10581")).toBe("10581");
  });
});

describe("htmlToText", () => {
  it("turns paragraphs and list items into lines and decodes entities", () => {
    expect(htmlToText("<p>Hei &amp; h&aring;, &Oslash;</p><ul><li>Senger: 9</li><li>Hund&#8203;</li></ul><p>&nbsp;</p>")).toBe(
      "Hei & hå, Ø\n- Senger: 9\n- Hund\u200b",
    );
    expect(htmlToText("<p></p>")).toBeUndefined();
  });
});

describe("booking normaliser", () => {
  it("counts free beds per night at a self-service cabin", () => {
    const nights = normalizeAvailability(fixture("booking/calendar-101265-autumn.json"));
    expect(nights.map((n) => n.date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    for (const n of nights) {
      expect(n.status).toBe(n.bedsAvailable! > 0 ? "available" : "full");
      expect(n.bedsAvailable).toBeLessThanOrEqual(6);
      // Skarvheim sells 6 of its 9 beds online.
      expect(n.bookableBeds).toBe(6);
      // Units are single beds, grouped as "Seng".
      expect(n.options?.map((o) => o.name) ?? []).toEqual(n.bedsAvailable ? ["Seng"] : []);
    }
  });

  it("breaks a staffed cabin down by category and leaves tent pitches out of the bed count", () => {
    const [night] = normalizeAvailability(fixture("booking/calendar-10581-summer.json"));
    const byName = Object.fromEntries(night!.options!.map((o) => [o.name, o.available]));
    expect(byName["Teltplass"]).toBeGreaterThan(0);
    const beds = night!.options!.filter((o) => !/teltplass|madrass/i.test(o.name)).reduce((s, o) => s + o.available, 0);
    expect(night).toMatchObject({ date: "2027-07-10", status: "available", bedsAvailable: beds });
    // Categories don't say how many beds they hold in total.
    expect(night!.bookableBeds).toBeUndefined();
  });

  it("weights units by persons_max", () => {
    const payload = {
      data: {
        availabilityList: [{ date: "2027-07-01T00:00:00.000Z", products: [{ available: 2, product: { product_id: 5, unit_id: 0 } }] }],
        products: [{ product_id: 5, unit_id: 0, product_name: "Familierom", attributes: [{ group: { name: "persons_max" }, value: "4" }] }],
      },
    };
    expect(normalizeAvailability(payload)).toEqual([
      { date: "2027-07-01", status: "available", bedsAvailable: 8, options: [{ name: "Familierom", available: 8 }] },
    ]);
  });

  it("reports a night with nothing left as full", () => {
    const payload = { data: { availabilityList: [{ date: "2027-07-01T00:00:00.000Z", products: [{ available: 0, product: {} }] }] } };
    expect(normalizeAvailability(payload)).toEqual([{ date: "2027-07-01", status: "full", bedsAvailable: 0 }]);
  });

  it("returns nothing for an unexpected payload", () => {
    expect(normalizeAvailability({ error: "nope" })).toEqual([]);
  });
});
