import { describe, expect, it } from "vitest";
import type { Cabin } from "../src/domain.js";
import { compareTrips, findTrips, joinSteps, type Place, type Step, tripStats } from "../src/planning/trips.js";
import { TrekService } from "../src/service.js";
import { FixtureBookingSource, FixtureTrailSource } from "./fake-sources.js";

// A triangle A–B–C (C–A only matched by distance) and a spur B–D, with
// cabins about 10 km apart.
const at = (lat: number, lon: number) => ({ lat, lon });
const cabin = (id: string, lat: number, lon: number, routeIds: string[]): Cabin =>
  ({ id, name: id, serviceLevel: "self-service", dntCabin: true, beds: {}, url: "", location: at(lat, lon), routeIds }) as Cabin;
const cabins: Record<string, Cabin> = {
  A: cabin("A", 61.0, 8.0, ["ab"]),
  B: cabin("B", 61.1, 8.0, ["ab", "bc", "bd"]),
  C: cabin("C", 61.1, 8.2, ["bc"]),
  D: cabin("D", 61.2, 8.0, ["bd"]),
};
const routes: [string, string, string, number][] = [
  ["ab", "A", "B", 5],
  ["bc", "B", "C", 6],
  ["ca", "C", "A", 8],
  ["bd", "B", "D", 4],
];
const steps = async (from: Place): Promise<Step[]> =>
  routes.flatMap(([id, a, b, hours]) => {
    const other = from.id === a ? b : from.id === b ? a : undefined;
    if (!other) return [];
    const to = cabins[other]!;
    return [{ routeId: id, name: id, grading: "moderate", durationHours: hours, distanceKm: hours * 3, reversed: false, url: "", toCabin: to, end: to.location } as Step];
  });

describe("hut trip search", () => {
  it("finds loops in both directions and out-and-back trips, never sleeping twice in one cabin", async () => {
    const trips = await findTrips({ start: cabins.A!, end: cabins.A!, nights: 2, steps });
    const names = trips.map((t) => [t[0]!.from.id, ...t.map((l) => l.to.id)].join(""));
    expect(names.sort()).toEqual(["ABCA", "ACBA"]);
    const outAndBack = await findTrips({ start: cabins.A!, end: cabins.A!, nights: 1, steps });
    expect(outAndBack.map((t) => t.map((l) => l.step.routeId).join(",")).sort()).toEqual(["ab,ab", "ca,ca"]);
  });

  it("marks links only matched by distance", async () => {
    const [abca] = await findTrips({ start: cabins.A!, end: cabins.A!, nights: 2, steps, maxHoursPerDay: 8 });
    expect(abca!.map((l) => l.link)).toEqual(["listed", "listed", "nearby"]);
    expect(tripStats(abca!)).toMatchObject({ totalKm: 57, totalHours: 19, maxDayHours: 8, guessedLinks: 1, repeatedRoutes: 0 });
  });

  it("skips days over maxHoursPerDay", async () => {
    const trips = await findTrips({ start: cabins.A!, end: cabins.A!, nights: 2, steps, maxHoursPerDay: 7 });
    expect(trips).toEqual([]);
  });

  it("without an end, stops at the last night's cabin", async () => {
    const trips = await findTrips({ start: cabins.A!, nights: 2, steps });
    expect(trips.map((t) => t.map((l) => l.to.id).join("")).sort()).toEqual(["BC", "BD", "CB"]);
  });

  it("ranks confirmed links first, then loops before out-and-back", () => {
    const loop = { totalKm: 50, maxDayHours: 8, guessedLinks: 0, repeatedRoutes: 0 };
    expect(compareTrips(loop, { ...loop, repeatedRoutes: 1, maxDayHours: 4 })).toBeLessThan(0);
    expect(compareTrips(loop, { ...loop, guessedLinks: 1 })).toBeLessThan(0);
    expect(compareTrips(loop, { ...loop, maxDayHours: 6 })).toBeGreaterThan(0);
  });
});

describe("joined days", () => {
  // A and B are cabins; J is a junction (a route end with no cabin).
  const J = at(61.05, 8.1);
  const net: [string, Place, Place | undefined, number][] = [
    ["aj", cabins.A!, undefined, 2],
    ["jb", { id: "J", name: "Junction", location: J }, cabins.B!, 3],
    ["ba", cabins.B!, cabins.A!, 4],
  ];
  const isAt = (p: Place, q?: Place) => !!q && (p.id === q.id || (!!p.location && !!q.location && p.location.lat === q.location.lat && p.location.lon === q.location.lon));
  const jSteps = async (from: Place): Promise<Step[]> =>
    net.flatMap(([id, a, b, hours]) => {
      const bPlace = b ?? { id: "J", name: "Junction", location: J };
      const [other, back] = isAt(from, a) ? [bPlace, false] : isAt(from, bPlace) ? [a, true] : [undefined, false];
      if (!other) return [];
      const toCabin = cabins[other.id];
      return [{ routeId: id, name: id, to: other.name, grading: back ? "tough" : "easy", durationHours: hours, distanceKm: hours * 3, reversed: back, url: "", toCabin, end: other.location } as Step];
    });

  it("walks through a junction to reach a cabin, as one day", async () => {
    const trips = await findTrips({ start: cabins.A!, end: cabins.A!, nights: 1, steps: jSteps });
    const joined = trips.find((t) => t[0]!.step.routeId === "aj+jb")!;
    expect(joined.map((l) => l.step.routeId)).toEqual(["aj+jb", "ba"]);
    expect(joined[0]).toMatchObject({ link: "nearby", step: { through: ["Junction"], durationHours: 5, distanceKm: 15, grading: "easy" } });
  });

  it("keeps joined days within the day's hours", async () => {
    const trips = await findTrips({ start: cabins.A!, end: cabins.A!, nights: 1, steps: jSteps, maxHoursPerDay: 4.5 });
    expect(trips.map((t) => t.map((l) => l.step.routeId).join(","))).toEqual(["ba,ba"]);
  });

  it("joins steps into one day: sums, hardest grading, places walked through", () => {
    const step = (routeId: string, hours: number, grading: string, to: string) => ({ routeId, name: routeId, to, grading, durationHours: hours, distanceKm: 2, ascentM: 100, reversed: false, url: "" }) as Step;
    expect(joinSteps([step("x", 1, "easy", "Lid"), step("y", 2.5, "tough", "Høgabu")])).toMatchObject({
      routeId: "x+y",
      durationHours: 3.5,
      distanceKm: 4,
      ascentM: 200,
      grading: "tough",
      through: ["Lid"],
    });
  });
});

describe("findHutTrips on the fixture network", () => {
  const svc = new TrekService(new FixtureTrailSource(), new FixtureBookingSource(), {});

  it("chains cabins to an end cabin, with a bed check per night", async () => {
    const res = await svc.findHutTrips({ startCabinId: "fx-gjendesheim", endCabinId: "fx-olavsbu", nights: 2, type: "foot", startDate: "2026-07-01" });
    expect(res.options.map((o) => o.summary)).toEqual(["Gjendesheim → Memurubu → Gjendebu → Olavsbu"]);
    expect(res.options[0]!.days.map((d) => d.night?.verdict ?? "-")).toEqual([expect.any(String), expect.any(String), "-"]);
    expect(res.options[0]!.days[0]).toMatchObject({ date: "2026-07-01", routeId: "fx-r1", link: "listed" });
  });

  it("explains an empty result with the cabins one route away", async () => {
    // The fixture network is a tree: no 2-night loop from Gjendesheim.
    const res = await svc.findHutTrips({ startCabinId: "fx-gjendesheim", loop: true, nights: 2, type: "foot" });
    expect(res.tripsFound).toBe(0);
    expect(res.hint).toContain("Memurubu");
  });

  it("starts from a point, such as a car park", async () => {
    const res = await svc.findHutTrips({ start: { lat: 61.4945, lon: 8.8117 }, startName: "Car park", loop: true, nights: 1, type: "foot" });
    expect(res.options[0]!.summary).toBe("Car park → Memurubu → Car park");
    expect(res.options[0]!.days.map((d) => d.link)).toEqual(["nearby", "nearby"]);
  });
});
