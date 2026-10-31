// "A connection needs you": one small helper any module can call when a connection it owns stops working (a hub key revoked, a CRM key refused, a sign-in ended). It opens or keeps a single task for
// the right person, an Unblock request that shows in Home's Needs you, and closes it when a call works again. `call` must be the host's own service actor (the system identity sync and polls use), not the person whose call failed, so
// so whoever's call works first closes the item and the tasks rules stay as they are. It never throws: a connection that cannot raise its task must not turn one failed call into two. The task says what to do in a line, never why in provider words, and never holds a secret.
export type Call = (cap: string, input: unknown) => Promise<unknown>;
export interface Assignee { kind: "person" | "role" | "group"; id: string }
export interface NeedsYou {
  /** The connection's id (con_..., mcs_...): the task is found by it. */
  id: string;
  /** What the person does, as a short phrase: "Replace the Composio key". */
  title: string;
  summary?: string;
  /** The connection's owner, or `{ kind: "role", id: "admin" }` when the key is Shared. */
  to: Assignee;
}

interface Row { id: string; state: string; source?: { kind: string; id: string } }
const sourceOf = (id: string): { kind: "manual"; id: string } => ({ kind: "manual", id: `connection:${id}` });

async function open(call: Call, id: string): Promise<Row[]> {
  const out = (await call("tasks.list", { scope: "all", kinds: ["unblock"], states: ["todo", "doing"] })) as { tasks?: Row[] };
  return (out.tasks ?? []).filter((t) => t.source?.id === `connection:${id}`);
}

/** Opens the task for this connection, or keeps the one that is open. Safe to call on every failure. */
export async function connectionNeedsYou(call: Call, n: NeedsYou): Promise<void> {
  try {
    if ((await open(call, n.id)).length > 0) return;
    await call("tasks.create", {
      kind: "unblock", title: n.title, ...(n.summary ? { summary: n.summary } : {}), assigned: n.to, source: sourceOf(n.id),
      idempotencyKey: globalThis.crypto.randomUUID(),
    });
  } catch { /* the connection's own error already tells the caller */ }
}

/** A call worked: closes the task for this connection if one is open. */
export async function connectionWorks(call: Call, id: string): Promise<void> {
  try {
    for (const t of await open(call, id)) await call("tasks.transition", { taskId: t.id, to: "canceled", note: "It works again." });
  } catch { /* an admin can still dismiss it */ }
}
