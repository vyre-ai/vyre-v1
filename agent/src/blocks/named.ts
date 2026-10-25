// The blocks an agent's native environment makes most often, with the rules that belong to each (spec "native", ARCH 6.8, 6.10, 6.11). Each helper takes the facts, fills what follows from them,
// and goes through the one emitter, so the same schema and the same secret rules apply.
import type { Blocks } from "./emit.ts";
import type { Block, EmitOptions } from "./types.ts";

type Layer = "person" | "agent" | "project" | "space";
type Opts = Omit<EmitOptions, "state"> & { state?: EmitOptions["state"] };

export interface BlockHelpers {
  /** "Saved to your person layer: ..." A fact already in the shared Space layer cannot be proposed for the team again. */
  memorySaved(f: { factId: string; layer: Layer; text: string; agentId?: string; canPromote?: boolean }, o: Opts): Block;
  /** "Used #Dana_Lawmatics (filled). The value was not shown." Names, handle and field names only. */
  vaultUsed(u: { itemId: string; name: string; handle: string; fields: string[]; outcome: "used" | "filled" | "blocked"; where?: "device" | "host" | "computer" }, o: Opts): Block;
  /** The approver's card for an access request: waiting until someone decides. */
  accessRequest(r: { requestId: string; requester: string; resource: { type: string; id: string }; resourceTitle: string; level: "view" | "use" | "edit" | "manage"; note?: string; state?: "waiting" | "granted" | "declined" }, o: Opts): Block;
  /** A field the person types a value into: the value goes straight to vault.item.put and never into the thread. */
  secretInput(s: { name: string; kind: string; folderId: string; fields: string[]; hint?: string }, o: Opts): Block;
  /** The model changed for a step or for the thread. */
  modelSwitch(s: { threadId: string; agentId: string; scope: "sub_task" | "thread"; from: { provider: string; model: string; effort?: string }; to: { provider: string; model: string; effort?: string }; reason?: string }, o: Opts): Block;
  /** A helper sub-task under a chat: live while it runs, error when it failed. */
  helper(h: { threadId: string; parentThreadId: string; title: string; status: "running" | "done" | "failed" | "stopped"; agentId: string; model?: string; path: Array<{ title: string; threadId: string }> }, o: Opts): Block;
  /** A proposed change to roles, grants, schema, policy, settings or connectors, as before and after. */
  diffCard(d: { diffId: string; kind: "role" | "grant" | "schema" | "policy" | "setting" | "connector" | "config"; title: string; changes: Array<{ path: string; before: unknown; after: unknown }>; affects?: string }, o: Opts): Block;
}

const strip = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export function blockHelpers(b: Blocks): BlockHelpers {
  return {
    memorySaved: (f, o) => b.emit("memory_saved", strip({ factId: f.factId, layer: f.layer, text: f.text, agentId: f.agentId, canPromote: f.canPromote ?? f.layer !== "space" }), o),
    vaultUsed: (u, o) => b.emit("vault_used", strip({ itemId: u.itemId, name: u.name, handle: u.handle, fields: u.fields, outcome: u.outcome, where: u.where }), o),
    accessRequest: (r, o) => b.emit("access_request", strip({ ...r, state: r.state ?? "waiting" }), { state: (r.state ?? "waiting") === "waiting" ? "waiting" : "done", ...o }),
    secretInput: (s, o) => b.emit("secret_input", strip({ name: s.name, kind: s.kind, folderId: s.folderId, fields: s.fields, hint: s.hint }), o),
    modelSwitch: (s, o) => b.emit("model_switch", strip({ ...s }), o),
    helper: (h, o) => b.emit("helper", strip({ ...h }), { state: h.status === "running" ? "live" : h.status === "failed" ? "error" : "done", ...o }),
    diffCard: (d, o) => b.emit("diff_card", strip({ ...d }), o),
  };
}
