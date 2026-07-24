import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  allowBooleanAttributes: true,
});

export function parseXml<T = unknown>(xml: string): T {
  return parser.parse(xml) as T;
}

export function arrayOf<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function text(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return text(record.value ?? record["#text"]);
  }
  return undefined;
}

export function numberValue(value: unknown): number | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = Number(raw.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function booleanValue(value: unknown): boolean {
  const raw = text(value)?.toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "x";
}
