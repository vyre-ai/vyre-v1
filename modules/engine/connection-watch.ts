// What each hub or sign-in connection last did, so a key that stops working opens its one task once and a working call closes it once (never per call). A 401 means the key was revoked or the
// sign-in ended: the task goes to the admins (the connection is the Space's), says what to do in a line, and closes itself when the connection answers again.
import { connectionNeedsYou, connectionWorks } from "../../lib/needs-you.ts";
import { hubById } from "../../lib/mcp-hubs.ts";
import { engineHost } from "./runtime.ts";
import type { ServerSpec } from "./plugin-runtime.ts";

const standing = new Map<string, "ok" | "bad">();

/** Vault > Connections: what each connection last did, recorded on the connection when it changes (never per call), and who last used it, at most once a minute per agent. */
const lastHealth = new Map<string, string>();
const lastUse = new Map<string, number>();
const USE_EVERY_MS = 60_000;

export type ConnectionHealth = "ok" | "needs_signin" | "key_refused" | "not_answering";
/** A plain reading of an outcome: a refused key, a sign-in that is needed or ended, or no answer. */
export function healthOf(spec: Pick<ServerSpec, "oauth">, outcome: "ok" | { error: string }): ConnectionHealth {
  if (outcome === "ok") return "ok";
  if (/needs to be signed in|sign(ed)? in first/i.test(outcome.error)) return "needs_signin";
  if (/answered 401|answered 403|unauthori[sz]ed|forbidden|invalid (api )?key/i.test(outcome.error)) return spec.oauth ? "needs_signin" : "key_refused";
  return "not_answering";
}

/** Records the health on the connection as the host. A plain sentence goes with it, never a stack and never a value (the runtime scrubs filled secrets before any error reaches here). */
export async function noteConnectionHealth(spec: ServerSpec, outcome: "ok" | { error: string }, tools?: number): Promise<void> {
  const id = spec.connectionId;
  const host = engineHost();
  if (!id || !host) return;
  const health = healthOf(spec, outcome);
  const sig = `${health}|${tools ?? ""}`;
  if (lastHealth.get(id) === sig) return;
  lastHealth.set(id, sig);
  const note = outcome === "ok" ? "" : outcome.error.split("\n")[0]!.replace(/\s+at\s.*$/, "").slice(0, 200);
  await host.call("plugins.connection.checked", { connectionId: id, health, ...(note ? { note } : {}), ...(tools !== undefined ? { tools } : {}) }).catch(() => { lastHealth.delete(id); });
}

/** Records that an agent called a connection's tool. A person's own call (no agent) only stamps the time. */
export async function noteConnectionUse(spec: ServerSpec, agentId: string | undefined): Promise<void> {
  const id = spec.connectionId;
  const host = engineHost();
  if (!id || !host) return;
  const key = `${id}|${agentId ?? ""}`;
  const now = Date.now();
  if (now - (lastUse.get(key) ?? 0) < USE_EVERY_MS) return;
  lastUse.set(key, now);
  await host.call("plugins.connection.checked", { connectionId: id, ...(agentId && /^agt_/.test(agentId) ? { usedBy: agentId } : {}) }).catch(() => undefined);
}

/** The task is opened and closed as the host's own service actor, not as whoever's call it was, so whoever's call succeeds first closes it and the tasks rules stay as they are. */
export async function watchConnection(spec: ServerSpec, outcome: "ok" | { error: string }, tools?: number): Promise<void> {
  const id = spec.connectionId;
  const host = engineHost();
  await noteConnectionHealth(spec, outcome, tools);
  if (!id || !host || (!spec.hub && !spec.oauth)) return;
  const call = (cap: string, input: unknown): Promise<unknown> => host.call(cap, input);
  const was = standing.get(id);
  if (outcome === "ok") {
    standing.set(id, "ok");
    if (was !== "ok") await connectionWorks(call, id);
    return;
  }
  if (!/answered 401/.test(outcome.error)) return;
  standing.set(id, "bad");
  if (was === "bad") return;
  const hub = hubById(spec.hub);
  await connectionNeedsYou(call, {
    id, title: hub ? `Replace the ${hub.name} key` : `Sign in to ${spec.name} again`,
    summary: hub ? "Stopped accepting the key. Apps through it are paused until it is replaced." : "Ended the sign-in.",
    to: { kind: "role", id: "admin" }, from: hub ? hub.name : spec.name, ...(hub ? { fix: "replace_key", notes: { hub: hub.id } } : {}),
  });
}
