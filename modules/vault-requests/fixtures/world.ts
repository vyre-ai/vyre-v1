// A small Space for the vault request tests: a folder managed by Mira, a Space owner and an admin, a member who can ask, and an agent working a Run. The host's other modules are scripted
// stand-ins that answer what the handlers ask and record every call, so a test can read exactly what left the module (and see that no value did).
import { MemoryDb } from "./db.ts";
import type { PKind, VaultReqCtx } from "../projections.ts";

export const NOW = 1_700_000_000_000;
export const FOLDER = "vfd_team";

export interface Call { cap: string; input: Record<string, unknown> }
export interface Event { name: string; subject: string; payload: unknown }
export interface Script {
  /** persons with Manage on a folder, by folder id */
  managers: Record<string, string[]>;
  owners: string[];
  admins: string[];
  /** field keys of the items a manager can attach, by item id */
  items: Record<string, string[]>;
  /** the owner of the Space resource, when there is one (ruling 74: the decider of a key no folder claims) */
  spaceOwner?: string;
  /** capabilities that should fail, with the message */
  fail: Record<string, string>;
}

export function world(over: Partial<Script> = {}) {
  const db = new MemoryDb();
  const calls: Call[] = [];
  const events: Event[] = [];
  const warnings: string[] = [];
  const script: Script = { managers: { [FOLDER]: ["usr_mira"] }, owners: ["usr_owner"], admins: ["usr_admin"], items: { vit_have: ["api_key", "account"], vit_thin: ["account"] }, fail: {}, ...over };
  let task = 0;
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as Record<string, unknown>;
    calls.push({ cap, input: i });
    const f = script.fail[cap];
    if (f) throw new Error(f);
    switch (cap) {
      case "access.shares_of": {
        if ((i["resource"] as { type: string }).type === "space") return { shares: script.spaceOwner ? [{ grant: { id: "g_owner", subject: { kind: "person", id: script.spaceOwner }, level: "manage" }, through: "owner" }] : [] };
        const folder = (i["resource"] as { id: string }).id;
        const people = script.managers[folder] ?? [];
        return { shares: people.map((id, n) => ({ grant: { id: `g${n}`, subject: { kind: "person", id }, level: "manage" }, through: n === 0 ? "owner" : "direct" })) };
      }
      case "access.roles.get": return { holders: (i["roleId"] === "rol_owner" ? script.owners : script.admins).map((id) => ({ kind: "person", id })) };
      case "tasks.create": return { task: { id: `tsk_${++task}` } };
      case "tasks.transition": return { task: { id: i["taskId"] } };
      case "vault.item.get": {
        const keys = script.items[String(i["itemId"])];
        if (!keys) throw new Error("no such item");
        return { item: { id: i["itemId"], fieldKeys: keys }, fields: keys.map((key) => ({ key, secret: true, hasValue: true })) };
      }
      case "vault.item.put": return { item: { id: "vit_new", fieldKeys: (i["fields"] as { key: string }[]).map((f) => f.key) } };
      case "vault.share": return { granted: true };
      case "runs.resume": return { run: { id: i["runId"] } };
      default: throw new Error(`unexpected call ${cap}`);
    }
  };
  const as = (id: string, kind: PKind = "person", actingFor?: string): VaultReqCtx => ({
    space: "spc_test", principal: { kind, id }, ...(actingFor ? { actingFor } : {}), trace: { traceId: "0123456789abcdef0123456789abcdef" }, now: () => NOW, db,
    emit(name, subject, payload) { events.push({ name, subject, payload }); }, call, log: { warn(msg, attrs) { warnings.push(`${msg} ${JSON.stringify(attrs ?? {})}`); } },
  });
  return { db, calls, events, warnings, script, as, called: (cap: string): Call[] => calls.filter((c) => c.cap === cap) };
}
export type World = ReturnType<typeof world>;
