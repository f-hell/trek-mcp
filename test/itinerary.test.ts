import { describe, expect, it } from "vitest";
import type { Cabin, NightAvailability } from "../src/domain.js";
import { buildItinerary, findStartDates, indexAvailability, judgeNight } from "../src/planning/itinerary.js";

const cabin = (id: string, lat: number, lon: number, bookingId: string | null = `b-${id}`): Cabin => ({
  id,
  name: id.toUpperCase(),
  serviceLevel: "staffed",
  dntCabin: true,
  beds: {},
  location: { lat, lon },
  url: "",
  bookingId: bookingId ?? undefined,
});

const a = cabin("a", 61.4945, 8.8117);
const b = cabin("b", 61.5025, 8.57);

const nights = (spec: Record<string, number>): NightAvailability[] =>
  Object.entries(spec).map(([date, beds]) => ({ date, status: beds > 0 ? "available" : "full", bedsAvailable: beds }));

describe("judgeNight", () => {
  it("distinguishes bookable states", () => {
    expect(judgeNight(a, { date: "x", status: "available", bedsAvailable: 4 }, 4)).toBe("ok");
    expect(judgeNight(a, { date: "x", status: "available", bedsAvailable: 3 }, 4)).toBe("insufficient");
    expect(judgeNight(a, { date: "x", status: "available" }, 4)).toBe("likely");
    expect(judgeNight(a, { date: "x", status: "closed" }, 1)).toBe("closed");
    expect(judgeNight(a, undefined, 1)).toBe("unknown");
    expect(judgeNight(cabin("c", 0, 0, null), undefined, 1)).toBe("not-bookable");
  });
});

describe("buildItinerary", () => {
  const idx = indexAvailability({
    a: nights({ "2026-07-01": 5, "2026-07-02": 5, "2026-07-03": 5 }),
    b: nights({ "2026-07-02": 1, "2026-07-03": 4, "2026-07-04": 4 }),
  });

  it("walks nights and legs in order", () => {
    const it = buildItinerary([{ cabin: a, nights: 2 }, { cabin: b, nights: 1 }], "2026-07-01", 2, idx);
    expect(it.nights.map((n) => [n.date, n.cabinId, n.verdict])).toEqual([
      ["2026-07-01", "a", "ok"],
      ["2026-07-02", "a", "ok"],
      ["2026-07-03", "b", "ok"],
    ]);
    expect(it.endDate).toBe("2026-07-04");
    expect(it.legs).toHaveLength(1);
    expect(it.legs[0]!.date).toBe("2026-07-03");
    expect(it.legs[0]!.straightLineKm).toBeGreaterThan(10);
    expect(it.feasible).toBe(true);
  });

  it("flags nights without enough beds", () => {
    const it = buildItinerary([{ cabin: a, nights: 1 }, { cabin: b, nights: 1 }], "2026-07-01", 2, idx);
    expect(it.feasible).toBe(false);
    expect(it.problems).toEqual(["2026-07-02 B: insufficient"]);
  });

  it("finds feasible start dates in a window", () => {
    const stops = [{ cabin: a, nights: 1 }, { cabin: b, nights: 1 }];
    expect(findStartDates(stops, "2026-07-01", "2026-07-03", 2, idx)).toEqual([
      { startDate: "2026-07-02", uncertainNights: 0 },
      // 2026-07-03: a is known, b on 07-04 is ok
      { startDate: "2026-07-03", uncertainNights: 0 },
    ]);
  });
});
