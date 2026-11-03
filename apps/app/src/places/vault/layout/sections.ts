// The Vault's four sections (owner, 3 Nov: AI providers, Google and Microsoft, and everything else fully separated). An item is shown in its one primary section; the + adds only the kind of
// the page it is on, and in All it first asks which of the four. The pickers offer only their own section's kinds. Pure: what an item is, where the + goes, what each picker lists.

/** The four places an item lives. */
export type Section = "ai" | "google" | "connections" | "other";

/** A Vault item as these rules read it. */
export interface Itemish { id: string; kind: string; name: string; handle: string; folderId: string }

/** The folders Vyre keeps for Google and Microsoft (the company connection) and for connections' tokens. */
export const COMPANY_FOLDER = "Company connections";
export const CONNECTIONS_FOLDER = "Connections";

/** Keys of the company connection and of people's own Google or Microsoft sign-ins, by name or handle: Google_DWD, Sso_Google_Secret, Microsoft_App, Ms_Tenant_Secret... */
const GOOGLE_MS = /^#?(google|gmail|gws|sso_google|sso_microsoft|sso_ms|microsoft|ms|m365|azure|entra|outlook|onedrive|sharepoint)(_|\b)/i;
/** The AI templates of the everything-else reel: they belong to AI accounts. */
export const AI_TEMPLATES: ReadonlySet<string> = new Set(["openai", "anthropic"]);
/** Google and Microsoft templates of the reel: they belong to Google and Microsoft. */
export const GOOGLE_TEMPLATES: ReadonlySet<string> = new Set(["google", "microsoft"]);

/** The one section an item is shown in: an AI account first, then Google and Microsoft, then a connection's key, then everything else. */
export function sectionOf(it: Itemish, providerItemIds: ReadonlySet<string>, folderName: (folderId: string) => string | undefined): Section {
  if (providerItemIds.has(it.id) || it.kind === "ai_subscription") return "ai";
  const folder = folderName(it.folderId);
  if (folder === COMPANY_FOLDER || GOOGLE_MS.test(it.handle) || GOOGLE_MS.test(it.name.replace(/\s+/g, "_"))) return "google";
  if (folder === CONNECTIONS_FOLDER) return "connections";
  return "other";
}

/** What the + opens on a page: that page's own kind, or (in All, Mine, a folder, Health, Requested) the one question first. */
export type AddTarget = Section | "ask";
export function addTarget(selection: { kind: string }): AddTarget {
  switch (selection.kind) {
    case "providers": return "ai";
    case "google": return "google";
    case "connections": return "connections";
    case "keys": case "logins": case "cards": return "other";
    default: return "ask";
  }
}

/** The one quiet question of the top-level +: four rows, in this order. */
export const ADD_CHOICES: ReadonlyArray<{ target: Section; title: string; line: string }> = [
  { target: "ai", title: "An AI account", line: "Claude, ChatGPT, Grok, OpenCode, OpenRouter, Gemini, or an API key for one" },
  { target: "google", title: "Google or Microsoft", line: "Your company's connection, or your own mail, calendar and files" },
  { target: "connections", title: "An app or tool server", line: "An app such as Monday or HubSpot, or an MCP server" },
  { target: "other", title: "A key, login or card", line: "Anything else you want kept and filled in for you" },
];

/** The AI picker: AI providers only, one tile each, with the one step it takes (Sign in for a subscription, Paste for a key, an address for a local model). */
export interface CatalogEntry { key: string; name: string; connections: readonly string[] }
export function aiTiles(catalog: readonly CatalogEntry[]): Array<{ key: string; name: string; step: "Sign in" | "Paste a key" | "Model address" }> {
  return catalog.map((c) => ({ key: c.key, name: c.name, step: c.connections.includes("subscription") ? "Sign in" as const : c.connections.includes("api_key") ? "Paste a key" as const : "Model address" as const }));
}

/** The everything-else reel: no AI provider and no Google or Microsoft template (those are added in their own sections). */
export function otherTemplates<T extends { id: string }>(templates: readonly T[]): T[] {
  return templates.filter((t) => !AI_TEMPLATES.has(t.id) && !GOOGLE_TEMPLATES.has(t.id));
}
