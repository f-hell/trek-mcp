import { describe, expect, it } from "vitest";
import { normalizeAvailability } from "../src/sources/booking/normalize.js";
import { bookingIdFromUrl, normalizeCabin, serviceLevel, unwrapList } from "../src/sources/utno/normalize.js";

describe("ut.no normalisers", () => {
  it("maps cabin fields and GeoJSON coordinates", () => {
    const c = normalizeCabin({
      id: 42,
      name: "Testbu",
      serviceLevel: "self_service",
      geometry: { type: "Point", coordinates: [8.5, 61.5] },
      bookingUrl: "https://hyttebestilling.dnt.no/hytte/101265",
      bedsToday: 20,
    });
    expect(c).toMatchObject({ id: "42", serviceLevel: "self-service", location: { lat: 61.5, lon: 8.5 }, bookingId: "101265", beds: { total: 20 } });
  });

  it("understands Norwegian service levels", () => {
    expect(serviceLevel("Betjent")).toBe("staffed");
    expect(serviceLevel("ubetjent")).toBe("no-service");
  });

  it("unwraps relay connections", () => {
    expect(unwrapList({ totalCount: 1, edges: [{ node: { id: 1 } }] })).toEqual({ nodes: [{ id: 1 }], total: 1 });
  });

  it("parses booking ids only from hyttebestilling urls", () => {
    expect(bookingIdFromUrl("https://example.com/hytte/1")).toBeUndefined();
  });
});

describe("booking normaliser", () => {
  it("accepts a list of days", () => {
    expect(normalizeAvailability({ days: [{ date: "2026-07-02T00:00:00", freeBeds: 0 }, { date: "2026-07-01", freeBeds: 3 }] })).toEqual([
      { date: "2026-07-01", status: "available", bedsAvailable: 3 },
      { date: "2026-07-02", status: "full", bedsAvailable: 0 },
    ]);
  });

  it("accepts a date-keyed map and explicit statuses", () => {
    expect(normalizeAvailability({ "2026-07-01": 2, "2026-07-02": { status: "closed" } })).toEqual([
      { date: "2026-07-01", status: "available", bedsAvailable: 2 },
      { date: "2026-07-02", status: "closed", bedsAvailable: undefined },
    ]);
  });
});
