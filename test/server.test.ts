import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TrekService } from "../src/service.js";
import { registerTools } from "../src/tools.js";
import { FixtureBookingSource, FixtureTrailSource } from "./fake-sources.js";

// The real tool layer over MCP, in process, with fake sources: no network.
describe("MCP server", () => {
  const client = new Client({ name: "test", version: "0" });

  beforeAll(async () => {
    const server = new McpServer({ name: "trek-mcp", version: "test" });
    registerTools(server, new TrekService(new FixtureTrailSource(), new FixtureBookingSource(), {}));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  });
  afterAll(() => client.close());

  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    const content = res.content as { type: string; text: string }[];
    return JSON.parse(content[0]!.text);
  };

  it("lists the planning tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "check_availability",
      "find_hut_trips",
      "find_routes_between_cabins",
      "find_signature_routes",
      "get_cabin",
      "get_cabin_routes",
      "get_route",
      "get_trip",
      "plan_hut_to_hut",
      "search_areas",
      "search_cabins",
      "search_trips",
    ]);
  });

  it("searches cabins near a point", async () => {
    const res = await call("search_cabins", { near: { lat: 61.49, lon: 8.6, radiusKm: 15 } });
    expect(res.items.map((c: { name: string }) => c.name)).toContain("Memurubu");
    // Long texts are for get_cabin.
    expect(res.items.some((c: object) => "description" in c || "access" in c || "bookingNotes" in c)).toBe(false);
  });

  it("plans a hut-to-hut trip with alternatives", async () => {
    const res = await call("plan_hut_to_hut", {
      stops: [
        { cabinId: "fx-gjendesheim", nights: 1 },
        { cabinId: "fx-memurubu", nights: 1 },
        { cabinId: "fx-gjendebu", nights: 1 },
      ],
      startDate: "2027-07-10",
      guests: 2,
      flexDays: 14,
    });
    expect(res.itinerary.nights).toHaveLength(3);
    expect(res.itinerary.legs.map((l: { to: string }) => l.to)).toEqual(["Memurubu", "Gjendebu"]);
    expect(Array.isArray(res.alternatives)).toBe(true);
    expect(res.bookingLinks.Gjendebu).toMatch(/hyttebestilling\.dnt\.no\/hytte\//);
    // July: the summer route, not the ski route over the lake
    expect(res.itinerary.legs[0].routes.map((r: { routeId: string }) => r.routeId)).toEqual(["fx-r1"]);
  });

  it("finds well-known routes through a cabin", async () => {
    const res = await call("find_signature_routes", { cabinId: "fx-memurubu" });
    expect(res.map((t: { id: string }) => t.id)).toEqual(["fx-sig1"]);
  });

  it("lists routes out of a cabin with the cabin at the other end", async () => {
    const res = await call("get_cabin_routes", { cabinId: "fx-memurubu", type: "foot" });
    const byTarget = Object.fromEntries(res.routes.map((r: { toCabin: { id: string } }) => [r.toCabin.id, r]));
    expect(Object.keys(byTarget).sort()).toEqual(["fx-gjendebu", "fx-gjendesheim"]);
    // fx-r1 is stored Gjendesheim → Memurubu; from Memurubu it runs in reverse
    expect(byTarget["fx-gjendesheim"]).toMatchObject({ routeId: "fx-r1", reversed: true, from: "Memurubu", to: "Gjendesheim" });
    expect(res.signatureRoutes.map((s: { id: string }) => s.id)).toEqual(["fx-sig1"]);
  });

  it("finds direct and one-stop routes between cabins", async () => {
    const res = await call("find_routes_between_cabins", { fromCabinId: "fx-gjendesheim", toCabinId: "fx-gjendebu", type: "foot" });
    expect(res.direct).toEqual([]);
    expect(res.viaOneCabin).toHaveLength(1);
    expect(res.viaOneCabin[0]).toMatchObject({ via: { id: "fx-memurubu" }, totalKm: 27, totalHours: 12 });
    expect(res.viaOneCabin[0].legs.map((l: { from: string; to: string }) => `${l.from}→${l.to}`)).toEqual([
      "Gjendesheim→Memurubu",
      "Memurubu→Gjendebu",
    ]);
  });
});
