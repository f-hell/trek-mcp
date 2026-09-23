// Shared helpers for mapping JSON from the sites into domain types.

export type Raw = Record<string, unknown>;

export const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

export function pick(raw: Raw, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = k.split(".").reduce<unknown>((o, part) => (isObj(o) ? o[part] : undefined), raw);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

export function str(raw: Raw, ...keys: string[]): string | undefined {
  const v = pick(raw, ...keys);
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
}

export function num(raw: Raw, ...keys: string[]): number | undefined {
  const v = pick(raw, ...keys);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

export function bool(raw: Raw, ...keys: string[]): boolean | undefined {
  const v = pick(raw, ...keys);
  return typeof v === "boolean" ? v : undefined;
}

/** GeoJSON Point ([lon, lat]) or {lat, lon}/{latitude, longitude}. */
export function latLon(v: unknown): { lat: number; lon: number } | undefined {
  if (!isObj(v)) return undefined;
  const coords = v.coordinates;
  if (Array.isArray(coords) && typeof coords[0] === "number" && typeof coords[1] === "number") {
    return { lon: coords[0], lat: coords[1] };
  }
  const lat = num(v, "lat", "latitude");
  const lon = num(v, "lon", "lng", "longitude");
  return lat !== undefined && lon !== undefined ? { lat, lon } : undefined;
}
