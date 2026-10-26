// NewTabData for the two callers: the real shell (from the open Space's search data) and the sample Space the shots draw. The page itself never knows which.
import { replicaHits } from "../cmdk/gate.ts";
import type { GateNav } from "../cmdk/gate.ts";
import type { CmdKData } from "../cmdk/controller.ts";
import type { Hit } from "../cmdk/model.ts";
import type { ShellRuntime } from "../providers/runtime.tsx";
import type { PlaceId } from "../rail/kits.ts";
import type { NewTabData, StartKind } from "./model.ts";

const START_PLACE: Record<StartKind, PlaceId> = { chat: "chats", agent: "chats", task: "home", record: "records", file: "files", folder: "files" };

/** The page's hooks over a search data object: where each Start tile and record type leads. */
export function newTabData(base: CmdKData, nav: Pick<GateNav, "go">, extra: { faces: () => readonly Hit[]; folders: () => readonly Hit[]; recordTypes: () => readonly string[] }): NewTabData {
  return {
    ...base,
    ...extra,
    start: (kind) => nav.go(START_PLACE[kind], `new=${kind}`),
    openType: (type) => nav.go("records", `type=${encodeURIComponent(type)}`),
  };
}

/** What the Space answers ahead of the page: its root folders (files.tree) and its record types (schema.types.list). */
export interface NewTabAhead { folders: readonly Hit[]; types: readonly { key: string; title: string }[] }

const FOLDER_LINK = "vyre://folder/";

/** Read both lists; a Space that cannot answer shows the page without them. */
export async function loadNewTabAhead(rt: ShellRuntime): Promise<NewTabAhead> {
  const [tree, types] = await Promise.all([
    rt.call("files.tree", {}).catch(() => null) as Promise<{ roots: { title: string; kind: string; folderId?: string }[] } | null>,
    rt.call("schema.types.list", { limit: 20 }).catch(() => null) as Promise<{ types: { key: string; plural: string }[] } | null>,
  ]);
  const folders = (tree?.roots ?? []).filter((r) => r.kind === "folder" && r.folderId !== undefined)
    .map((r): Hit => ({ kind: "file", id: r.folderId as string, title: r.title, link: `${FOLDER_LINK}${r.folderId}`, score: 1, snippet: "Folder" }));
  return { folders, types: (types?.types ?? []).map((t) => ({ key: t.key, title: t.plural })) };
}

/** The real shell: faces are the people and agents the replica holds (you excluded); folders open in Files, record types in Records. */
export function realNewTabData(base: CmdKData, rt: ShellRuntime, nav: Pick<GateNav, "go">, ahead: NewTabAhead): NewTabData {
  const full = newTabData({
    ...base,
    open: (hit, opts) => (hit.link.startsWith(FOLDER_LINK) ? nav.go("files", `folder=${hit.id}`) : base.open(hit, opts)),
  }, nav, {
    faces: () => replicaHits(rt).filter((h) => (h.kind === "agent" || h.kind === "person") && h.id !== rt.me.id).slice(0, 12),
    folders: () => ahead.folders,
    recordTypes: () => ahead.types.map((t) => t.title),
  });
  return { ...full, openType: (title) => nav.go("records", `type=${encodeURIComponent(ahead.types.find((t) => t.title === title)?.key ?? title)}`) };
}
