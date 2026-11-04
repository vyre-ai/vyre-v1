// ui/ArtifactCard model: what the artifact card and the Artifacts list say about one artifact, as plain functions (no React). The card, the grid and the viewer header all read these, so
// the one quiet line ("Page · Private to you · updated 3:53") is the same everywhere.

export interface ArtifactInfo {
  id: string;
  name: string;
  owner: string;
  /** sites.list access: who can open it besides its owner. */
  access?: "public" | "password" | "space" | "private" | undefined;
  updatedAt?: number | undefined;
  /** A small picture taken at publish (an address or a data URL). The card draws a stand-in without one. */
  thumb?: string | undefined;
  /** The chat that made it, when the host knows. */
  from?: { id: string; title: string } | undefined;
  /** People it is shared with by name, when known (otherwise the access level says it). */
  sharedWith?: readonly string[] | undefined;
  /** Who else can open it without a name: anyone with the link, everyone in the Space. */
  audience?: readonly ("link" | "space")[] | undefined;
}

export type ArtifactFilter = "Mine" | "Shared with me" | "All";
export const ARTIFACT_FILTERS: readonly ArtifactFilter[] = ["Mine", "Shared with me", "All"];

const DAY = 86_400_000;
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const startOfDay = (t: number): number => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** "3:53" today, "yesterday", the weekday inside a week, else the date. */
export function whenLabel(at: number | undefined, now: number): string {
  if (at === undefined) return "";
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days <= 0) { const d = new Date(at); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; }
  if (days === 1) return "yesterday";
  if (days < 7) return WEEKDAY[new Date(at).getDay()]!;
  return new Date(at).toLocaleDateString();
}

const join = (names: readonly string[]): string => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}` : names[0] ?? "");

/** Who can see it, in the words a person uses. */
export function sharingLine(a: ArtifactInfo, meId: string, nameOf: (id: string) => string = (id) => id): string {
  if (a.owner !== meId) return `Shared by ${nameOf(a.owner)}`;
  const who = [...(a.sharedWith ?? []), ...(a.audience?.includes("space") ? ["everyone in the Space"] : []), ...(a.audience?.includes("link") ? ["anyone with the link"] : [])];
  if (who.length > 0) return `Shared with ${join(who)}`;
  if (a.access === "public") return "Public link";
  if (a.access === "space") return "Shared with the Space";
  if (a.access === "password") return "Password link";
  return "Private to you";
}

/** "Page · Private to you · updated 3:53". */
export function subline(a: ArtifactInfo, meId: string, now: number, nameOf?: (id: string) => string): string {
  const when = whenLabel(a.updatedAt, now);
  return `Page · ${sharingLine(a, meId, nameOf)}${when ? ` · updated ${when}` : ""}`;
}

/** The rows for one filter and search, newest update first. */
export function filterArtifacts<T extends ArtifactInfo>(rows: readonly T[], filter: ArtifactFilter, q: string, meId: string): T[] {
  const needle = q.trim().toLowerCase();
  return rows
    .filter((a) => (filter === "All" ? true : filter === "Mine" ? a.owner === meId : a.owner !== meId))
    .filter((a) => needle === "" || a.name.toLowerCase().includes(needle))
    .slice()
    .sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0));
}

/** The line under an empty list. */
export function emptyLine(filter: ArtifactFilter, q: string, any: boolean): string {
  if (q.trim() !== "") return `Nothing matches “${q.trim()}”`;
  if (!any) return "Nothing published yet";
  return filter === "Shared with me" ? "Nobody has shared an artifact with you yet" : "Nothing here";
}

/** The address to copy or open: a full address as given, else the path on this app's own origin. */
export function linkOf(open: { path: string; url?: string | undefined }, origin: string | undefined): string {
  return open.url ?? `${(origin ?? "").replace(/\/+$/, "")}${open.path}`;
}

/** Which of four stand-in drawings a card shows without a picture, from the id (so a card keeps its look). */
export function standIn(id: string): 0 | 1 | 2 | 3 {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 4) as 0 | 1 | 2 | 3;
}
