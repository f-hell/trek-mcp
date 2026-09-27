import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DNT_BED_RULES } from "./planning/itinerary.js";
import type { TrekService } from "./service.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const serviceLevel = z.enum(["staffed", "self-service", "no-service", "emergency", "closed", "unknown"]);
const grading = z.enum(["easy", "moderate", "tough", "expert", "unknown"]);
const near = z
  .object({ lat: z.number(), lon: z.number(), radiusKm: z.number().positive().max(200) })
  .describe("Search around a point (WGS84).");

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

export function registerTools(server: McpServer, svc: TrekService): void {
  server.registerTool(
    "search_cabins",
    {
      title: "Search cabins",
      description:
        "Find DNT and other cabins on ut.no by name, area, service level (staffed = betjent, self-service = selvbetjent, no-service = ubetjent) or proximity.",
      inputSchema: {
        text: z.string().optional(),
        areaId: z.string().optional(),
        serviceLevels: z.array(serviceLevel).optional(),
        near: near.optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    async (args) => {
      const res = await svc.trails.searchCabins(args);
      return json({ ...res, items: res.items.map((c) => svc.withBookingId(c)) });
    },
  );

  server.registerTool(
    "get_cabin",
    {
      title: "Get cabin",
      description: "Full details for one cabin: beds, service level, DNT key requirement, location, open/closed periods by service level (openings), " +
        "the ut.no description as text (house rules, beds for booking vs drop-in, arrival deadlines, dogs, payment), how to get there in summer and winter (access), and the hyttebestilling booking id if bookable.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => json(await svc.getCabin(id)),
  );

  server.registerTool(
    "search_trips",
    {
      title: "Search trips",
      description: "Find suggested trips on ut.no by name, area, grading, max duration or proximity. Multi-day trips report durationDays instead of durationHours and are excluded by maxDurationHours. seasonMonths lists the recommended months.",
      inputSchema: {
        text: z.string().optional(),
        areaId: z.string().optional(),
        gradings: z.array(grading).optional(),
        maxDurationHours: z.number().positive().optional(),
        near: near.optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    async (args) => json(await svc.trails.searchTrips(args)),
  );

  server.registerTool(
    "get_trip",
    {
      title: "Get trip",
      description: "Full details for one hike: distance, duration, ascent, grading, and cabins along the way.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const trip = await svc.trails.getTrip(id);
      if (!trip) throw new Error(`No trip with id ${id}`);
      return json(trip);
    },
  );

  server.registerTool(
    "search_areas",
    {
      title: "Search areas",
      description: "Find hiking areas (e.g. Jotunheimen, Hardangervidda) on ut.no; use the id to narrow cabin and trip searches.",
      inputSchema: { text: z.string(), limit: z.number().int().min(1).max(50).default(20) },
    },
    async ({ text, limit }) => json(await svc.trails.searchAreas(text, limit)),
  );

  const routeType = z.enum(["foot", "ski"]).optional().describe("foot = summer (T-marked), ski = winter (pole-marked)");

  server.registerTool(
    "find_signature_routes",
    {
      title: "Find well-known routes",
      description:
        "Start here for well-known multi-day routes: DNT's SignaTUR list of its signature long-distance hikes (e.g. Høgruta i Jotunheimen, SAGA, MASSIV), " +
        "with days, distance, grading and the cabins on the way (cabinIds). Filter by name/area text, area id, a cabin on the route, proximity or max days. " +
        "Use get_trip for the day-by-day stages, and plan_hut_to_hut to check the cabins.",
      inputSchema: {
        text: z.string().optional(),
        areaId: z.string().optional(),
        cabinId: z.string().optional().describe("Only routes through this cabin"),
        near: near.optional(),
        maxDays: z.number().int().positive().optional(),
      },
    },
    async (args) => json(await svc.signatureRoutes(args)),
  );

  server.registerTool(
    "get_cabin_routes",
    {
      title: "Routes from a cabin",
      description:
        "DNT marked routes out of a cabin, with the cabin at the other end (toCabin), distance, and grading, time and ascent in the direction away from this cabin. " +
        "Use it to explore the route network one step at a time. Also lists signature routes that pass the cabin.",
      inputSchema: { cabinId: z.string(), type: routeType },
    },
    async ({ cabinId, type }) => json(await svc.routesFromCabin(cabinId, type)),
  );

  server.registerTool(
    "find_routes_between_cabins",
    {
      title: "Routes between two cabins",
      description:
        "Marked routes from one cabin to another: direct routes, and two-leg alternatives via one intermediate cabin, with times and ascent in the direction of travel. " +
        "Times are DNT's estimates for a normally fit hiker.",
      inputSchema: { fromCabinId: z.string(), toCabinId: z.string(), type: routeType },
    },
    async ({ fromCabinId, toCabinId, type }) => json(await svc.routesBetween(fromCabinId, toCabinId, type)),
  );

  server.registerTool(
    "get_route",
    {
      title: "Get route",
      description:
        "Full description of one marked route in both directions (terrain, exposure, river crossings, bridges), winter marking dates for ski routes, and the ut.no link.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const [route] = await svc.trails.getRoutes([id]);
      if (!route) throw new Error(`No route with id ${id}`);
      return json(route);
    },
  );

  server.registerTool(
    "check_availability",
    {
      title: "Check cabin availability",
      description:
        "Nightly free bookable beds for a cabin on hyttebestilling.dnt.no between two dates (to is exclusive), with a breakdown per room type, tent pitch etc. (options). " +
        "dropInBeds are beds that can't be pre-booked (first come, first served). bedRules gives the general rules (claim by 19:00); bookingNotes (ut.no) " +
        "and hyttebestilling (booking conditions such as membership or DNT key, meals, room sharing) are the cabin's own and take precedence. " +
        "Nights in a period ut.no lists as closed are marked closed. Read-only; returns the booking link, never books.",
      inputSchema: { cabinId: z.string().describe("ut.no cabin id"), from: isoDate, to: isoDate },
    },
    async ({ cabinId, from, to }) => {
      const cabin = await svc.getCabin(cabinId);
      if (!cabin.bookingId) {
        return json({
          cabin: cabin.name,
          bookable: false,
          bookingUrl: cabin.bookingUrl,
          note: cabin.bookingUrl
            ? "Not on hyttebestilling; availability has to be checked at bookingUrl."
            : "Not bookable online (often first come, first served).",
          bookingNotes: cabin.bookingNotes,
          bedRules: DNT_BED_RULES,
        });
      }
      return json({
        cabin: cabin.name,
        bookable: true,
        bookingUrl: svc.booking.bookingUrl(cabin.bookingId),
        nights: await svc.availability(cabin, from, to),
        bookingNotes: cabin.bookingNotes,
        hyttebestilling: await svc.bookingInfo(cabin),
        bedRules: DNT_BED_RULES,
      });
    },
  );

  server.registerTool(
    "plan_hut_to_hut",
    {
      title: "Plan hut-to-hut trip",
      description:
        "Check a chain of cabins night by night for a group, cross-checked between ut.no and hyttebestilling. Each leg lists the direct marked routes (foot in June–October, else ski, when both exist). Reports blocked nights and stays over a cabin's max length (problems), " +
        "nights that rely on drop-in beds, other booking channels, cabin notices or source disagreements (warnings), each cabin's own notes (cabinNotes), site-wide notices, " +
        "and straight-line leg distances, and optionally find alternative start dates within a flexible window.",
      inputSchema: {
        stops: z
          .array(z.object({ cabinId: z.string(), nights: z.number().int().min(1).max(7).default(1) }))
          .min(1)
          .max(15),
        startDate: isoDate,
        guests: z.number().int().min(1).max(30),
        flexDays: z.number().int().min(0).max(60).default(0).describe("Also try start dates up to this many days later."),
      },
    },
    async (args) => json(await svc.planHutToHut(args)),
  );
}
