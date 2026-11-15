// "A connection needs you": one small helper any module can call when a connection it owns stops working (a hub key revoked, a CRM key refused, a sign-in ended). It opens or keeps a single task for
// the right person, an Unblock request that shows in Home's Needs you, and closes it when a call works again. `call` must be the host's own service actor (the system identity sync and polls use), not the person whose call failed, so
// so whoever's call works first closes the item and the tasks rules stay as they are. It never throws: a connection that cannot raise its task must not turn one failed call into two. The task says what to do in a line, never why in provider words, and never holds a secret.
export type Call = (cap: string, input: unknown) => Promise<unknown>;
export interface Assignee {
  kind: "person" | "role" | "group";
  id: string;
}
export interface NeedsYou {
  /** The connection's id (con_..., mcs_...): the task is found by it. */
  id: string;
  /** What the person does, as a short phrase: "Replace the Composio key". */
  title: string;
  summary?: string;
  /** The connection's owner, or `{ kind: "role", id: "admin" }` when the key is Shared. */
  to: Assignee;
  /** Who the item is from, as a person reads it: "Composio" for a hub, "Vyre" by default. Never a person's name. */
  from?: string;
  /** What the primary button does ("replace_key" opens the Replace key sheet); more notes the item carries for its screen. */
  fix?: string;
  notes?: Record<string, string>;
}

interface Row {
  id: string;
  state: string;
  source?: { kind: string; id: string };
}
const sourceOf = (id: string): { kind: "manual"; id: string } => ({ kind: "manual", id: `connection:${id}` });

async function open(call: Call, id: string): Promise<Row[]> {
  const out = (await call("tasks.list", { scope: "all", kinds: ["unblock"], states: ["todo", "doing"] })) as {
    tasks?: Row[];
  };
  return (out.tasks ?? []).filter((t) => t.source?.id === `connection:${id}`);
}

/** Opens the task for this connection, or keeps the one that is open. Safe to call on every failure. */
export async function connectionNeedsYou(call: Call, n: NeedsYou): Promise<void> {
  try {
    if ((await open(call, n.id)).length > 0) return;
    await call("tasks.create", {
      kind: "unblock",
      title: n.title,
      ...(n.summary ? { summary: n.summary } : {}),
      assigned: n.to,
      source: sourceOf(n.id),
      notes: { origin: n.from ?? "Vyre", connection: n.id, ...(n.fix ? { fix: n.fix } : {}), ...(n.notes ?? {}) },
      idempotencyKey: globalThis.crypto.randomUUID(),
    });
  } catch {
    /* the connection's own error already tells the caller */
  }
}

/** A call worked: closes the task for this connection if one is open. */
export async function connectionWorks(call: Call, id: string): Promise<void> {
  try {
    for (const t of await open(call, id))
      await call("tasks.transition", { taskId: t.id, to: "canceled", note: "It works again." });
  } catch {
    /* an admin can still dismiss it */
  }
}

/**
 * A routine's agent was refused for something it can never do on its own (above its clearance, or a permission its role does not hold) and has stopped asking. The person the routine works for is told once, as a
 * line in Needs you, in plain words: which agent, and that it needs more access or a different routine. One line per agent and tool, however many runs meet it.
 */
export async function agentRefusedNeedsYou(
  call: Call,
  n: { agentId: string; agentName?: string; asker: string; tool: string },
): Promise<void> {
  const who = n.agentName && n.agentName.trim() !== "" ? n.agentName.trim() : "An agent";
  await connectionNeedsYou(call, {
    id: `refusal:${n.agentId}:${n.tool}`,
    title: `${who} was stopped by an access limit`,
    summary: `${who} asked for something its access does not allow, in a routine of yours, and has stopped asking. Give it the access, or change the routine so it does not need it.`,
    to: { kind: "person", id: n.asker },
    from: "Vyre",
  });
}
