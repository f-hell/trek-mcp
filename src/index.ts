#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { TrekService } from "./service.js";
import { HyttebestillingClient } from "./sources/booking/client.js";
import { FixtureBookingSource, FixtureTrailSource } from "./sources/fixtures.js";
import { UtnoClient } from "./sources/utno/client.js";
import { registerTools } from "./tools.js";

const svc = config.fixtures
  ? new TrekService(new FixtureTrailSource(), new FixtureBookingSource())
  : new TrekService(new UtnoClient(), new HyttebestillingClient());

const server = new McpServer({ name: "trek-mcp", version: "0.1.0" });
registerTools(server, svc);
await server.connect(new StdioServerTransport());
console.error(`trek-mcp running on stdio${config.fixtures ? " (fixture mode)" : ""}`);
