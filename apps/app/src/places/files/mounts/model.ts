// The mount sheet's logic without a renderer (spec 2.16 Mounts, 3.5 Files > mount a folder): the three steps, what a pick means, the mounts.add input, who can see it, error words.
// Steps: 1 pick a source (Google Drive, Microsoft 365, this computer, GitHub); 2 browse or search and pick one thing; 3 options (name, who can see it, copy or branch, Into, Review changes).
// A mount is a real directory synced by the mount engine; access never widens, so "who can see it" is a share made after the mount exists (access.share), never a grant the sheet invents.
import type { CapMap } from "../../../../../../generated/types.ts";

export type MountKind = CapMap["mounts.add"]["in"]["source"]["kind"];
export type AddInput = CapMap["mounts.add"]["in"];
export type BrowseIn = CapMap["mounts.browse"]["in"];
export type MountRow = CapMap["mounts.list"]["out"]["mounts"][number];

export type SourceId = "google_drive" | "microsoft" | "local" | "github";

export interface SourceDef {
  id: SourceId;
  name: string;
  /** What gets mounted: the sentence in the Unmount sheet and the screen reader label. */
  what: string;
  /** The provider kinds one source browses. Microsoft 365 shows SharePoint libraries and OneDrive folders together. */
  kinds: readonly MountKind[];
}

export const SOURCES: readonly SourceDef[] = [
  { id: "google_drive", name: "Google Drive", what: "Google Shared Drive or folder", kinds: ["google_drive"] },
  { id: "microsoft", name: "Microsoft 365", what: "SharePoint library or OneDrive folder", kinds: ["sharepoint", "onedrive"] },
  { id: "local", name: "This computer", what: "Folder on your computer", kinds: ["local"] },
  { id: "github", name: "GitHub", what: "GitHub repository", kinds: ["github"] },
];

export function sourceOf(id: SourceId): SourceDef {
  return SOURCES.find((s) => s.id === id) ?? (SOURCES[0] as SourceDef);
}

/** The source a stored mount kind belongs to. */
export function sourceOfKind(kind: MountKind): SourceId {
  return kind === "sharepoint" || kind === "onedrive" ? "microsoft" : kind;
}

/** The account line under a source: who is connected there. Without a connection the row says so and the press connects it. */
export interface Account {
  label: string;
  connected: boolean;
  connectionId?: string;
  /** This computer: the device the folder lives on. */
  deviceId?: string;
}
export type Accounts = Record<SourceId, Account>;

export interface BrowseItem {
  ref: string;
  name: string;
  isFolder: boolean;
  path?: string;
  shared?: boolean;
  /** The provider kind this item came from (Microsoft 365 mixes two). */
  kind: MountKind;
}

export interface Crumb { ref: string; name: string; kind: MountKind }

export type Who = { mode: "me" } | { mode: "everyone" } | { mode: "people"; ids: readonly string[] };
export interface Person { id: string; name: string }

export interface Draft {
  step: 1 | 2 | 3;
  source: SourceId | null;
  /** Folders walked into, outermost first. */
  path: readonly Crumb[];
  picked: BrowseItem | null;
  q: string;
  /** Null until the person types; the default is the picked folder's name. */
  name: string | null;
  who: Who;
  copy: "server_copy" | "live_only";
  /** Null until the person flips it; the default follows the source (on for cloud folders and repositories). */
  review: boolean | null;
  branch: string;
  into: string;
}

export const emptyDraft = (into: string): Draft => ({
  step: 1, source: null, path: [], picked: null, q: "", name: null, who: { mode: "me" }, copy: "server_copy", review: null, branch: "main", into,
});

export const chooseSource = (d: Draft, source: SourceId): Draft => ({ ...d, step: 2, source, path: [], picked: null, q: "", name: null });
export const walkInto = (d: Draft, item: BrowseItem): Draft => ({ ...d, path: [...d.path, { ref: item.ref, name: item.name, kind: item.kind }], picked: null, q: "" });
/** Crumb index 0 is the source itself; index i keeps the first i folders. */
export const walkTo = (d: Draft, i: number): Draft => ({ ...d, path: d.path.slice(0, Math.max(0, i)), picked: null, q: "" });
/** A key for the folders walked into; the list reloads when it changes. */
export function pathKey(d: Draft): string {
  let key = "";
  for (const c of d.path) key += `${key ? "/" : ""}${c.ref}`;
  return key;
}
export const pick = (d: Draft, item: BrowseItem | null): Draft => ({ ...d, picked: item });
export const setQuery = (d: Draft, q: string): Draft => ({ ...d, q, picked: null });

export function canNext(d: Draft): boolean {
  return d.step === 2 && d.picked !== null;
}

export function next(d: Draft): Draft {
  return canNext(d) ? { ...d, step: 3 } : d;
}

export function back(d: Draft): Draft {
  if (d.step === 3) return { ...d, step: 2 };
  if (d.step === 2) return { ...d, step: 1, source: null, path: [], picked: null, q: "" };
  return d;
}

export function defaultName(d: Draft): string {
  const p = d.picked;
  if (!p) return "";
  if (d.source === "github") return p.ref.split("/").pop() ?? p.name;
  return p.name;
}

export const nameOf = (d: Draft): string => (d.name !== null ? d.name.trim() : defaultName(d));
export const reviewOf = (d: Draft): boolean => d.review ?? d.source !== "local";
export const canMount = (d: Draft): boolean => d.step === 3 && d.picked !== null && nameOf(d).length > 0;

/** Breadcrumb words: the source, then each folder walked into. Empty at the root, as the prototype shows none there. */
export function crumbs(d: Draft): string[] {
  if (d.source === null || d.path.length === 0) return [];
  return [sourceOf(d.source).name, ...d.path.map((c) => c.name)];
}

/** The mounts.browse calls that list the current level: one per provider kind at a source root, otherwise the kind of the folder walked into. */
export function browseInputs(d: Draft, account: Account, cursor?: string): BrowseIn[] {
  if (d.source === null) return [];
  const last = d.path[d.path.length - 1];
  const kinds = last ? [last.kind] : sourceOf(d.source).kinds;
  const q = d.q.trim();
  return kinds.map((kind) => ({
    kind,
    ...(account.connectionId ? { connectionId: account.connectionId } : {}),
    ...(last ? { parent: last.ref } : {}),
    ...(q ? { q } : {}),
    ...(cursor ? { cursor } : {}),
    limit: 50,
  }));
}

/** Whether a listed thing is already a mount (it shows "Mounted" and cannot be picked again). */
export function isMounted(item: BrowseItem, mounts: readonly MountRow[]): boolean {
  return mounts.some((m) => m.kind === item.kind && m.ref === item.ref);
}

/** The line at the right of a browse row. */
export function metaOf(item: BrowseItem, mounted: boolean): string {
  if (mounted) return "Mounted";
  if (item.path) return item.path;
  return item.shared ? "Shared" : "";
}

/** The mounts.add input for a finished draft, or null while something is missing. The key is stable for the same folder into the same place, so a double press mounts once. */
export function addInput(d: Draft, accounts: Accounts): AddInput | null {
  const p = d.picked;
  const src = d.source;
  if (p === null || src === null || !canMount(d)) return null;
  const acc = accounts[src];
  const source: AddInput["source"] = {
    kind: src === "microsoft" ? p.kind : (src as MountKind),
    ...(acc.connectionId ? { connectionId: acc.connectionId } : {}),
    ...(src === "local"
      ? { ...(acc.deviceId ? { deviceId: acc.deviceId } : {}), localPath: p.path ?? p.ref }
      : { ref: p.ref, ...(src !== "github" && p.path ? { path: p.path } : {}) }),
    ...(src === "github" ? { branch: d.branch.trim() || "main" } : {}),
  };
  return {
    into: d.into,
    source,
    name: nameOf(d),
    ...(src === "local" ? { mode: d.copy } : {}),
    reviewChanges: reviewOf(d),
    idempotencyKey: `mount:${source.kind}:${p.ref}:${d.into}`,
  };
}

/** What the person is told when the call fails. */
export function mountError(err: unknown, providerName: string): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  const text = `${typeof e?.code === "string" ? e.code : ""} ${typeof e?.message === "string" ? e.message : ""}`;
  if (text.includes("provider.auth_failed")) return `Reconnect ${providerName}, then mount again.`;
  if (text.includes("provider.unavailable")) return `${providerName} is not answering. Try again in a minute.`;
  if (text.includes("validation.duplicate")) return "That folder is already mounted.";
  if (text.includes("permission")) return "You need Edit on the folder to mount into it.";
  return "Could not mount that. Try again.";
}

/** The "Who can see it" value. */
export function whoLabel(w: Who, spaceName: string, people: readonly Person[]): string {
  if (w.mode === "me") return "Only you";
  if (w.mode === "everyone") return `Everyone in ${spaceName}`;
  const names: string[] = [];
  for (const id of w.ids) names.push(people.find((p) => p.id === id)?.name ?? id);
  return names.length <= 2 ? names.join(", ") : `${names.length} people`;
}

/** One person added to or taken out of the list; an empty list is Only you. */
export function togglePerson(w: Who, id: string): Who {
  const cur = w.mode === "people" ? w.ids : [];
  const ids = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  return ids.length ? { mode: "people", ids } : { mode: "me" };
}

export interface ShareInput {
  resource: { type: "folder"; id: string };
  subject: { kind: "person" | "group"; id: string };
  level: "view";
  idempotencyKey: string;
}

/** The access.share calls that follow a successful mount. Everyone needs the Space's everyone group; without one the choice is not offered. */
export function shareInputs(w: Who, folderId: string, everyoneGroupId: string | undefined): ShareInput[] {
  const one = (kind: "person" | "group", id: string): ShareInput => ({ resource: { type: "folder", id: folderId }, subject: { kind, id }, level: "view", idempotencyKey: `mount-share:${folderId}:${id}` });
  if (w.mode === "me") return [];
  if (w.mode === "everyone") return everyoneGroupId ? [one("group", everyoneGroupId)] : [];
  return w.ids.map((id) => one("person", id));
}

/** The Unmount sheet's words. */
export function unmountWords(row: Pick<MountRow, "name" | "kind" | "provider">): { title: string; body: string } {
  const where = row.kind === "local" ? "their folder on your computer" : row.kind === "github" ? "GitHub" : row.provider;
  return { title: "Unmount " + `“${row.name}”` + "?", body: `The files stay in ${where}.` };
}
