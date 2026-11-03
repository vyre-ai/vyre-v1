// The two server steps of a skill's first-run setup, kept apart from the page so a test drives exactly what the page does: the key a bundled server wants goes into the Vault (Mine for your own
// skill, Shared for a Space one) and only its handle reaches the skill; then the server is asked for its tools, which is the health check.
import { keyOf, vaultItemFor } from "./model.ts";
import type { Call } from "./model.ts";
import { ensureSpaceFolder } from "../../../../lib/space-folder.ts";

export interface Health { state: "working" | "needs" | "down" | "checking"; tools?: number; error?: string }
const idem = (): string => globalThis.crypto?.randomUUID?.() ?? `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Puts the key in the Vault and gives the skill its handle. The value goes to vault.item.put only; the skill keeps `#Item.value`. Answers the handle. */
export async function fileSkillKey(call: Call, o: { skill: string; skillId: string; need: string; value: string; space: boolean }): Promise<string> {
  // a Space skill's key: the Space's "Skills" folder, shared with everyone (lib/space-folder.ts); your own skill's key: a Mine folder
  const folders = o.space ? [] : ((await call("vault.folders.list", {})) as { folders: { id: string; scope: string }[] }).folders;
  const folderId = o.space
    ? await ensureSpaceFolder(call, { name: "Skills", idem: idem() })
    : folders.find((f) => f.scope === "mine")?.id ?? ((await call("vault.folders.create", { name: "Mine", scope: "mine", idempotencyKey: idem() })) as { folder: { id: string } }).folder.id;
  const item = vaultItemFor(o.skill, keyOf(o.need).key);
  await call("vault.item.put", { folderId, name: item, kind: "api_key", fields: [{ key: "value", value: o.value, secret: true }], idempotencyKey: idem() });
  const handle = `#${item}.value`;
  if (o.space) await call("skills.space.setup", { name: o.skill, setup: { [o.need]: handle }, idempotencyKey: idem() });
  else await call("skills.mine.set", { skillId: o.skillId, setup: { [o.need]: handle }, idempotencyKey: idem() });
  return handle;
}

/** Starts the skill's server for one agent and lists its tools: Working with a count, Not answering with the reason. */
export async function checkServer(call: Call, o: { skillId: string; server: string; agentId: string | undefined }): Promise<Health> {
  if (!o.agentId) return { state: "down", error: "make an agent first, then test" };
  try {
    const r = (await call("engine.mcp.tools", { agentId: o.agentId, server: `skill:${o.skillId}/${o.server}` })) as { servers: { ok: boolean; error?: string; tools: unknown[] }[] };
    const x = r.servers[0];
    return !x ? { state: "needs" } : x.ok ? { state: "working", tools: x.tools.length } : { state: "down", ...(x.error ? { error: x.error } : {}) };
  } catch (e) {
    const err = e as { message?: string; error?: { message?: string } };
    return { state: "down", error: err.error?.message ?? err.message ?? "The server did not answer." };
  }
}
