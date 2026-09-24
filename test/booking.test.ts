import { describe, expect, it } from "vitest";
import type { Cabin } from "../src/domain.js";
import type { PoliteHttp } from "../src/http.js";
import { dropInBeds, isClosed, TrekService } from "../src/service.js";
import { HyttebestillingClient } from "../src/sources/booking/client.js";
import { FixtureTrailSource } from "../src/sources/fixtures.js";

/**
 * Fake calendar like the site's: a window from the start of `fromDate`'s month
 * to the end of that half-year, with `beds` free on requested nights and 0 elsewhere.
 */
function fakeHttp(beds = 3) {
  const urls: string[] = [];
  const http = {
    async json(url: string) {
      urls.push(url);
      const u = new URL(url);
      const from = u.searchParams.get("fromDate")!;
      const to = u.searchParams.get("toDate")!;
      const windowEnd = `${from.slice(0, 4)}-${Number(from.slice(5, 7)) <= 6 ? "06-30" : "12-31"}`;
      const list = [];
      for (let d = new Date(`${from.slice(0, 8)}01T00:00:00Z`); d.toISOString().slice(0, 10) <= windowEnd; d.setUTCDate(d.getUTCDate() + 1)) {
        const date = d.toISOString().slice(0, 10);
        const inRange = date >= from && date < to;
        list.push({ date: `${date}T00:00:00.000Z`, products: [{ available: inRange ? beds : 0, product: { product_id: 1, unit_id: 1 } }] });
      }
      return { data: { availabilityList: list, products: [] } };
    },
  };
  return { http: http as unknown as PoliteHttp, urls };
}

const PATH = "/api/booking/availability-calendar?cabinId={id}&fromDate={from}&toDate={to}";

describe("HyttebestillingClient", () => {
  it("returns exactly the requested nights", async () => {
    const { http, urls } = fakeHttp();
    const nights = await new HyttebestillingClient(http, PATH).getAvailability("101265", "2026-10-01", "2026-10-03");
    expect(nights).toMatchObject([
      { date: "2026-10-01", status: "available", bedsAvailable: 3 },
      { date: "2026-10-02", status: "available", bedsAvailable: 3 },
    ]);
    expect(urls).toEqual(["https://hyttebestilling.dnt.no/api/booking/availability-calendar?cabinId=101265&fromDate=2026-10-01&toDate=2026-10-03"]);
  });

  it("pages when the site's window ends before the range does", async () => {
    const { http, urls } = fakeHttp();
    const nights = await new HyttebestillingClient(http, PATH).getAvailability("1", "2026-12-30", "2027-01-02");
    expect(nights.map((n) => n.date)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("fromDate=2027-01-01");
  });
});

describe("closed periods", () => {
  const cabin = {
    id: "1",
    bookingId: "1",
    openings: [
      { serviceLevel: "self-service", from: "2026-02-15", to: "2026-10-15", openAllYear: false },
      { serviceLevel: "closed", from: "2026-10-15", to: "2027-02-15", openAllYear: false },
    ],
  } as Cabin;

  it("uses ut.no opening periods", () => {
    expect(isClosed(cabin, "2026-10-14")).toBe(false);
    expect(isClosed(cabin, "2026-10-15")).toBe(true);
    expect(isClosed(cabin, "2027-03-01")).toBe(false);
  });

  it("derives drop-in beds from season beds minus beds sold online", () => {
    const skarvheim = { ...cabin, openings: [{ ...cabin.openings![0]!, beds: 9 }, cabin.openings![1]!] } as Cabin;
    expect(dropInBeds(skarvheim, { date: "2026-07-01", status: "full", bedsAvailable: 0, bookableBeds: 6 })).toBe(3);
    expect(dropInBeds(skarvheim, { date: "2026-07-01", status: "full", bedsAvailable: 0 })).toBeUndefined();
  });

  it("marks closed nights in availability", async () => {
    const { http } = fakeHttp();
    const svc = new TrekService(new FixtureTrailSource(), new HyttebestillingClient(http, PATH), {});
    expect(await svc.availability(cabin, "2026-10-14", "2026-10-16")).toMatchObject([
      { date: "2026-10-14", status: "available", bedsAvailable: 3 },
      { date: "2026-10-15", status: "closed" },
    ]);
  });
});
