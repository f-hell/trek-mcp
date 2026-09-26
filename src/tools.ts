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

  server.registerTool(
    "check_availability",
    {
      title: "Check cabin availability",
      description:
        "Nightly free bookable beds for a cabin on hyttebestilling.dnt.no between two dates (to is exclusive), with a breakdown per room type, tent pitch etc. (options). " +
        "dropInBeds are beds that can't be pre-booked (first come, first served). bedRules gives the general rules (claim by 19:00); bookingNotes (ut.no) " +
        "and hyttebestilling (status message, booking conditions, min/max nights, cancellation, booking-closed period, site notices) are the cabin's own and take precedence. " +
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
        "Check a chain of cabins night by night for a group, cross-checked between ut.no and hyttebestilling. Reports blocked nights and stays over a cabin's max length (problems), " +
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
