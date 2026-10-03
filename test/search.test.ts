import { describe, expect, it } from "vitest";
import type { Cabin } from "../src/domain.js";
import { snippet, TrekService } from "../src/service.js";
import { FixtureBookingSource, FixtureTrailSource } from "./fake-sources.js";
import { UtnoClient } from "../src/sources/utno/client.js";

const service = (cabins: Partial<Cabin>[]) => {
  const trails = new FixtureTrailSource();
  (trails as unknown as { cabins: Cabin[] }).cabins = cabins.map((c, i) => ({
    id: `c${i}`,
    name: `Cabin ${i}`,
    serviceLevel: "self-service",
    dntCabin: true,
    beds: { selfService: 10 },
    url: "",
    ...c,
  }));
  return new TrekService(trails, new FixtureBookingSource(), {});
};

describe("cabin search", () => {
  const svc = service([
    {
      name: "Storfiskhytta",
      facilities: ["water", "fishing"],
      municipalities: ["Aure"],
      description: "Fjellområdet preges av utallige små og mellomstore vann der sjansen er god for å lure ørreten på land.",
      openings: [{ serviceLevel: "self-service", openAllYear: true }],
    },
    {
      name: "Trollstua",
      facilities: ["boat", "canoe"],
      municipalities: ["Aure"],
      description: "Det er også fiskegarn her og mye fisk i vatnet. Fin ørret.",
      openings: [
        { serviceLevel: "self-service", from: "2026-06-01", to: "2026-10-01", openAllYear: false },
        { serviceLevel: "closed", from: "2026-10-01", to: "2027-06-01", openAllYear: false },
      ],
    },
    { name: "Elsewhere", facilities: ["fishing"], municipalities: ["Luster"] },
  ]);

  it("filters on municipality and facility tags, one short row per cabin", async () => {
    const res = await svc.searchCabins({ municipality: "aure", facilities: ["fishing"] });
    expect(res.items.map((c) => c.name)).toEqual(["Storfiskhytta"]);
    expect(res.items[0]).not.toHaveProperty("description");
    expect(res.items[0]).not.toHaveProperty("openings");
  });

  it("finds untagged cabins by a keyword in the description, with the text around it", async () => {
    const res = await svc.searchCabins({ municipality: "Aure", keyword: "ørret" });
    expect(res.items.map((c) => c.name)).toEqual(["Storfiskhytta", "Trollstua"]);
    expect(res.items[1]!.match).toBe("Det er også fiskegarn her og mye fisk i vatnet. Fin ørret.");
  });

  it("leaves out cabins closed on openOn and gives the service level that day", async () => {
    const res = await svc.searchCabins({ municipality: "Aure", openOn: "2026-10-10" });
    expect(res.items.map((c) => [c.name, c.serviceLevelOn])).toEqual([["Storfiskhytta", "self-service"]]);
  });
});

describe("snippet", () => {
  it("cuts long text around the match", () => {
    const text = `${"a ".repeat(200)}ørret${" b".repeat(200)}`;
    const s = snippet(text, "ØRRET")!;
    expect(s.startsWith("…") && s.endsWith("…") && s.includes("ørret")).toBe(true);
    expect(s.length).toBeLessThan(260);
    expect(snippet(text, "laks")).toBeUndefined();
  });
});

describe("ut.no cabin paging", () => {
  // Three pages of two cabins; every other cabin passes `where`. A request
  // filtered on ids is the follow-up that fetches the full records.
  class PagedUtno extends UtnoClient {
    requests = 0;
    override async gql(_query: string, variables: Record<string, unknown>) {
      this.requests++;
      const byId = (variables.filter as { id?: { in: number[] } }).id?.in;
      if (byId) return { cabins: { edges: byId.map((id) => ({ node: { id, name: "match", municipalities: [{ name: "Aure" }] } })) } };
      const after = Number((variables.paging as { after?: string }).after ?? 0);
      const ids = [after + 1, after + 2];
      return {
        cabins: {
          totalCount: 6,
          pageInfo: { hasNextPage: after + 2 < 6, endCursor: String(after + 2) },
          edges: ids.map((id) => ({ node: { id, name: id % 2 ? "match" : "other" } })),
        },
      };
    }
  }
  const where = (c: Cabin) => c.name === "match";

  it("stops paging once it has enough matches, and says there may be more", async () => {
    const utno = new PagedUtno();
    const res = await utno.searchCabins({ where, limit: 2 });
    expect(res.items.map((c) => c.id)).toEqual(["1", "3"]);
    // Full records, with the fields the scan leaves out.
    expect(res.items[0]!.municipalities).toEqual(["Aure"]);
    expect(res.more).toBe(true);
    expect(res.total).toBeUndefined();
    expect(utno.requests).toBe(3);
  });

  it("pages to the end when there are fewer matches than the limit", async () => {
    const utno = new PagedUtno();
    const res = await utno.searchCabins({ where, limit: 10 });
    expect(res).toMatchObject({ total: 3 });
    expect(res.more).toBeUndefined();
    expect(utno.requests).toBe(4);
  });
});
