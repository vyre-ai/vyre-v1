// The words and shape of a key request card. "Dana_Lawmatics" reads "Dana Lawmatics key"; a name that already ends in key is not doubled.
export interface KeyRequest { id: string; name: string; fields: string[]; reason: string; state: "waiting" | "fulfilled" | "declined" | "canceled"; folderId?: string }

export function keyWords(name: string): string {
  const w = name.replace(/_+/g, " ").trim();
  return /\bkey$/i.test(w) ? w : `${w} key`;
}

/** The request out of a vault.requests.get answer, or null when it does not look like one. */
export function requestOf(out: unknown): KeyRequest | null {
  const r = (out as { request?: Record<string, unknown> } | null)?.request;
  if (!r || typeof r["id"] !== "string" || typeof r["name"] !== "string") return null;
  const fields = Array.isArray(r["fields"]) ? (r["fields"] as unknown[]).map(String) : ["value"];
  const state = r["state"] === "fulfilled" || r["state"] === "declined" || r["state"] === "canceled" ? r["state"] : "waiting";
  return { id: r["id"], name: r["name"], fields, reason: typeof r["reason"] === "string" ? r["reason"] : "", state, ...(typeof r["folderId"] === "string" ? { folderId: r["folderId"] } : {}) };
}
