// Small readers for the untyped JSON a CLI writes. The formats are not published contracts and drift between versions, so every reader degrades to "nothing" instead of throwing.
export type Json = Record<string, unknown>;

export const obj = (v: unknown): Json | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function parseLine(line: string): Json | null {
  try { return obj(JSON.parse(line)); } catch { return null; }
}
