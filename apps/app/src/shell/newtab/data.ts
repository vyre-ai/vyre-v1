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

/** The real shell: faces are the people and agents the replica holds (you excluded); folders and record types are read ahead into the caches, empty until then. */
export function realNewTabData(base: CmdKData, rt: ShellRuntime, nav: Pick<GateNav, "go">, caches: { folders: () => readonly Hit[]; recordTypes: () => readonly string[] }): NewTabData {
  return newTabData(base, nav, {
    faces: () => replicaHits(rt).filter((h) => (h.kind === "agent" || h.kind === "person") && h.id !== rt.me.id).slice(0, 12),
    folders: caches.folders,
    recordTypes: caches.recordTypes,
  });
}
