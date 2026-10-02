import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Cabin, Route } from "../src/domain.js";
import { haversineKm } from "../src/geo.js";
import { cabinAtEnd, endsAt, farEnd, orient, orientTowards, preferType, seasonType } from "../src/planning/routes.js";
import { TrekService } from "../src/service.js";
import { FixtureBookingSource, FixtureTrailSource } from "../src/sources/fixtures.js";
import { normalizeRoute, unwrapList } from "../src/sources/utno/normalize.js";

const route: Route = {
  id: "r1",
  name: "A – B",
  from: "Alphabu",
  to: "Betahytta",
  distanceKm: 10,
  start: { lat: 61.0, lon: 8.0 },
  end: { lat: 61.1, lon: 8.2 },
  forward: { grading: "tough", durationHours: 5, ascentM: 800, descentM: 200 },
  reverse: { grading: "moderate", durationHours: 4, ascentM: 200, descentM: 800 },
  url: "",
};
const cabin = (id: string, lat: number, lon: number, routeIds: string[] = []): Cabin =>
  ({ id, name: id, serviceLevel: "staffed", dntCabin: true, beds: {}, location: { lat, lon }, url: "", routeIds }) as Cabin;

describe("route orientation", () => {
  it("uses the stats for the direction of travel", () => {
    expect(orient(route, cabin("a", 61.0, 8.0))).toMatchObject({ reversed: false, from: "Alphabu", to: "Betahytta", ascentM: 800 });
    expect(orient(route, cabin("b", 61.1, 8.2))).toMatchObject({ reversed: true, from: "Betahytta", to: "Alphabu", ascentM: 200, grading: "moderate" });
    expect(orientTowards(route, cabin("a", 61.0, 8.0))).toMatchObject({ reversed: true, to: "Alphabu" });
  });

  it("falls back to names without coordinates", () => {
    const noGeo = { ...route, start: undefined, end: undefined };
    expect(orient(noGeo, { name: "Betahytta" }).reversed).toBe(true);
    expect(orient(noGeo, { name: "Alphabu" }).reversed).toBe(false);
  });
});

describe("cabin at a route's end", () => {
  it("prefers a cabin that lists the route, else the nearest close one", () => {
    const near = [
      { cabin: cabin("x", 0, 0), distanceM: 50 },
      { cabin: cabin("y", 0, 0, ["r1"]), distanceM: 400 },
    ];
    expect(cabinAtEnd("r1", near, "a")?.id).toBe("y");
    expect(cabinAtEnd("r2", near, "a")?.id).toBe("x");
    expect(cabinAtEnd("r2", [{ cabin: cabin("x", 0, 0), distanceM: 900 }], "a")).toBeUndefined();
    expect(cabinAtEnd("r1", [{ cabin: cabin("a", 0, 0, ["r1"]), distanceM: 0 }], "a")).toBeUndefined();
  });

  it("prefers the cabin named like the route's place", () => {
    const near = [
      { cabin: { ...cabin("annex", 0, 0, ["r1"]), name: "Glitterheim Selvbetjent" }, distanceM: 20 },
      { cabin: { ...cabin("main", 0, 0), name: "Glitterheim" }, distanceM: 60 },
    ];
    expect(cabinAtEnd("r1", near, "a", "Glitterheim")?.id).toBe("main");
    expect(cabinAtEnd("r1", near, "a", "Memurubu")?.id).toBe("annex");
  });
});

describe("season", () => {
  it("prefers foot routes in summer and ski routes otherwise, if there are any", () => {
    expect(seasonType("2027-07-10")).toBe("foot");
    expect(seasonType("2027-03-20")).toBe("ski");
    const rs = [{ type: "foot" }, { type: "ski" }];
    expect(preferType(rs, "ski")).toEqual([{ type: "ski" }]);
    expect(preferType([{ type: "foot" }], "ski")).toEqual([{ type: "foot" }]);
  });
});

describe("real ut.no routes", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fixture = (name: string): any => JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));
  const [besseggen, sikkilsdal] = unwrapList(fixture("utno/routes-gjendesheim.json").data.routes).nodes.map(normalizeRoute);
  const gjendesheim = { name: "Gjendesheim", location: { lat: 61.49405, lon: 8.81277 } };

  it("maps a marked route", () => {
    expect(besseggen).toMatchObject({
      id: "135600",
      code: "jot2",
      type: "foot",
      from: "Gjendesheim",
      to: "Memurubu",
      via: "Besseggen",
      distanceKm: 14.3,
      forward: { grading: "expert", durationHours: 7 },
      url: "https://ut.no/rutebeskrivelse/135600",
    });
    expect(besseggen!.forward.description).toMatch(/Besseggen/);
  });

  it("orients by place names even when the line is drawn the other way", () => {
    // 136778 is "Sikkilsdalsseter → Gjendesheim" but its line starts at Gjendesheim.
    expect(sikkilsdal).toMatchObject({ from: "Sikkilsdalsseter", to: "Gjendesheim" });
    expect(haversineKm(sikkilsdal!.start!, gjendesheim.location)).toBeLessThan(0.75);
    expect(orient(sikkilsdal!, gjendesheim)).toMatchObject({ reversed: true, from: "Gjendesheim", to: "Sikkilsdalsseter" });
    // The far end is still the geometric one.
    expect(haversineKm(farEnd(sikkilsdal!, gjendesheim)!, gjendesheim.location)).toBeGreaterThan(10);
    expect(endsAt(sikkilsdal!, gjendesheim)).toBe(true);
  });
});

describe("routes between cabins", () => {
  it("reaches a self-service annex by the routes to the staffed hut next to it", async () => {
    const trails = new FixtureTrailSource();
    const annex = { ...cabin("fx-gjendebu-selvbetjent", 61.4781, 8.3929), name: "Gjendebu Selvbetjent", serviceLevel: "self-service" } as Cabin;
    (trails as unknown as { cabins: Cabin[] }).cabins.push(annex);
    const svc = new TrekService(trails, new FixtureBookingSource(), {});
    const res = await svc.routesBetween("fx-olavsbu", annex.id, "foot");
    expect(res.direct.map((r) => r.routeId)).toEqual(["fx-r4"]);
    // The staffed hut at the same spot isn't a stop on the way.
    expect(res.viaOneCabin.map((v) => v.via.id)).not.toContain("fx-gjendebu");
  });
});
