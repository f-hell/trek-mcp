// Tries a GraphQL introspection query against ut.no's API and saves the
// schema to recon/utno-schema.json. Many production APIs disable
// introspection; if so, fall back to `npm run recon`.
//
//   npm run introspect:utno            # uses UTNO_INTROSPECT_URL or the default
import { mkdir, writeFile } from "node:fs/promises";
import { getIntrospectionQuery } from "./introspection-query.js";

// Introspection is allowed on the backend; data queries go through ut.no/api/graphql.
const url = process.env.UTNO_INTROSPECT_URL ?? "https://api.ut.no/v1/graphql";
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json", "user-agent": "trek-mcp/0.1 (personal use)" },
  body: JSON.stringify({ query: getIntrospectionQuery() }),
});
const body = (await res.json().catch(() => null)) as { data?: { __schema?: { queryType?: { name: string }; types: { name: string; kind: string; fields?: { name: string }[] }[] } }; errors?: unknown } | null;
if (!body?.data?.__schema) {
  console.error(`Introspection failed (HTTP ${res.status}):`, JSON.stringify(body?.errors ?? body).slice(0, 500));
  process.exit(1);
}
await mkdir("recon", { recursive: true });
await writeFile("recon/utno-schema.json", JSON.stringify(body, null, 2));
const schema = body.data.__schema;
const q = schema.types.find((t) => t.name === (schema.queryType?.name ?? "Query"));
console.log(`Saved recon/utno-schema.json. Root query fields:\n  ${q?.fields?.map((f) => f.name).join("\n  ")}`);
