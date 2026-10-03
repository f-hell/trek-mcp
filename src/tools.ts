import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AreaType } from "./domain.js";
import { DNT_BED_RULES } from "./planning/itinerary.js";
import type { TrekService } from "./service.js";
import { AREA_TYPES, FACILITIES, SUITABLE_FOR } from "./sources/utno/normalize.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const serviceLevel = z.enum(["staffed", "self-service", "no-service", "emergency", "closed", "unknown"]);
const keys = (map: Record<number | string, string>) => z.enum(Object.values(map) as [string, ...string[]]);
const grading = z.enum(["easy", "moderate", "tough", "expert", "unknown"]);
const near = z
  .object({ lat: z.number(), lon: z.number(), radiusKm: z.number().positive().max(200) })
  .describe("Search around a point (WGS84).");

// Compact: indentation nearly doubles the size of nested results.
const BRIEF_CHARS = 300;
const brief = (text: string | undefined) => (text && text.length > BRIEF_CHARS ? `${text.slice(0, BRIEF_CHARS).trim()}…` : text);

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

export function registerTools(server: McpServer, svc: TrekService): void {
  server.registerTool(
    "search_cabins",
    {
      title: "Search cabins",
      description:
        "Find DNT and other cabins on ut.no by name, area, municipality, service level (staffed = betjent, self-service = selvbetjent, no-service = ubetjent), " +
        "facilities (e.g. fishing, boat, sauna), suitability (children, dogs) or proximity, optionally only those open on a date or whose description mentions a keyword. " +
        "Returns one short row per cabin; use get_cabin for the description, opening periods, access and booking notes. " +
        "Facility tags are entered by each cabin's owner and can be incomplete: if a facility filter finds little, try keyword (e.g. \"ørret\" for trout).",
      inputSchema: {
        text: z.string().optional().describe("Part of the cabin's name"),
        areaId: z.string().optional(),
        municipality: z.string().optional().describe('Norwegian municipality (kommune), e.g. "Aure"'),
        serviceLevels: z.array(serviceLevel).optional(),
        facilities: z.array(keys(FACILITIES)).optional().describe("Only cabins tagged with all of these"),
        suitableFor: z.array(keys(SUITABLE_FOR)).optional().describe("Only cabins tagged with all of these"),
        openOn: isoDate
          .optional()
          .describe(
            "Leave out cabins closed on this date, and give each cabin's service level then (serviceLevelOn). " +
              "\"unknown\" means ut.no lists no period covering the date, often because the cabin's periods are years out of date; check get_cabin or the booking calendar.",
          ),
        keyword: z.string().optional().describe("Only cabins whose description mentions this (Norwegian), with the text around it"),
        near: near.optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    async (args) => json(await svc.searchCabins(args)),
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
      description:
        "Find hiking areas (e.g. Jotunheimen, Hardangervidda) on ut.no by name; use the id to narrow cabin and trip searches. " +
        "Only DNT hiking areas by default; ut.no also has protected areas (nature reserves, national parks), wild reindeer areas and local DNT associations. " +
        "Areas aren't named after municipalities: for a place like Aure, use search_cabins with municipality and read each cabin's area.",
      inputSchema: {
        text: z.string(),
        types: z.array(keys(AREA_TYPES)).default(["dnt"]),
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    async ({ text, limit, types }) => {
      const res = await svc.trails.searchAreas(text, limit, types as AreaType[]);
      // Area texts run to thousands of characters (bus timetables, the same protected-area boilerplate); the link has the rest.
      return json({ ...res, items: res.items.map((a) => ({ ...a, description: brief(a.description) })) });
    },
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
        hyttebestilling: await svc.bookingInfo(cabin, from),
        bedRules: DNT_BED_RULES,
      });
    },
  );

  server.registerTool(
    "find_hut_trips",
    {
      title: "Find hut-to-hut trips",
      description:
        "Search the marked-route network for multi-day trips: start at a cabin or a point (e.g. a car park), sleep `nights` nights in different cabins, " +
        "and walk back to the start (loop), to an end cabin, or stop at the last cabin. A day is one marked route, or up to three joined where one ends at a junction, village or road end " +
        "(within maxHoursPerDay, else 9 h); joined days list the places walked through. With no result, a hint lists the cabins one route away. " +
        "With startDate, cabins closed on their night are skipped and the best options get a free-bed check per night. " +
        "Options are ranked: links confirmed on ut.no first (link \"nearby\" means a route end was only matched by distance; check the route), " +
        "then real loops before out-and-back, then the easiest longest day. Use plan_hut_to_hut on a chosen option for booking notes and alternative dates.",
      inputSchema: {
        startCabinId: z.string().optional().describe("Start at this cabin"),
        start: z.object({ lat: z.number(), lon: z.number() }).optional().describe("Or start at this point, e.g. a car park or trailhead"),
        startName: z.string().optional().describe("Name for the start point, e.g. \"Eidsbugarden\""),
        loop: z.boolean().default(true).describe("End where you started"),
        endCabinId: z.string().optional().describe("With loop false: end at this cabin"),
        nights: z.number().int().min(1).max(5),
        maxHoursPerDay: z.number().positive().optional().describe("DNT's estimated walking time"),
        type: routeType,
        startDate: isoDate.optional(),
        guests: z.number().int().min(1).max(30).default(1),
        limit: z.number().int().min(1).max(10).default(5),
      },
    },
    async (args) => json(await svc.findHutTrips(args)),
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
