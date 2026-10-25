// Every query key carries the spaceId (ARCH 9: a Space switch never shows mixed data).
export function stable(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}

export function queryKey(spaceId: string, cap: string, input: unknown): string {
  if (!spaceId) throw new Error("a query key needs a spaceId");
  return `${spaceId}\u001f${cap}\u001f${stable(input)}`;
}

export const screenKey = (spaceId: string, screenId: string, args: unknown): string => queryKey(spaceId, `screen:${screenId}`, args);
