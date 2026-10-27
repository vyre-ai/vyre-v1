// Connector trust ladder. A generated action starts as a draft.
// Space members see it only after a reviewed promotion. Built-in connectors are maintained with the product.
// Official API docs can seed a draft. They do not make every website connectable.

export type TrustLevel = "draft" | "private_verified" | "space_published" | "built_in";

export interface ConnectorDraft {
  key: string;
  level: TrustLevel;
  docsUrl?: string;
  tested: boolean;
  reviewed: boolean;
  auth: "oauth" | "api_key" | "none" | "unknown";
}

const ORDER: TrustLevel[] = ["draft", "private_verified", "space_published", "built_in"];

export function rank(level: TrustLevel): number {
  return ORDER.indexOf(level);
}

/** A person can promote one step up after the evidence for that step exists. Built-in is not a self-serve step. */
export function promote(draft: ConnectorDraft, to: TrustLevel): { ok: true; level: TrustLevel } | { ok: false; reason: string } {
  if (to === "built_in") return { ok: false, reason: "Built-in connectors ship with Vyre. A Space cannot promote itself there." };
  if (rank(to) !== rank(draft.level) + 1) return { ok: false, reason: "Promote one step at a time so the last known-good version stays live." };
  if (to === "private_verified" && (!draft.tested || draft.auth === "unknown")) {
    return { ok: false, reason: "Private verification needs a recorded test and a known authentication method." };
  }
  if (to === "space_published" && !draft.reviewed) return { ok: false, reason: "Space publication needs a review." };
  return { ok: true, level: to };
}

export function visibleInPalette(level: TrustLevel, audience: "author" | "space"): boolean {
  if (level === "draft") return audience === "author";
  if (level === "private_verified") return audience === "author";
  return level === "space_published" || level === "built_in";
}

export const CONNECT_LIMIT =
  "Vyre can draft a connector from official API documentation when the docs describe authentication, scopes, and requests. It cannot connect an arbitrary website. Providers differ, and some do not offer an API.";
