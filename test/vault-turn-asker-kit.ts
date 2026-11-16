// Whose authority a turn nobody typed runs on (lead 12 Nov; owner ruling 2 Nov: an act no person asked for in this turn runs only inside a task or Automation that HOLDS a person's permission).
// An inbound email, a form or a webhook starts no agent turn by itself: it starts an Automation Run. A Space Automation's task-mode step runs the agent's turn for its "runs as" person, the one who
// turned it on or last published it (the kernel lets an agent act only for a person), checked when the step runs; when that fails the task waits, assigned, with a plain line, until a person starts
// it. Before this, the task's turn borrowed the agent owner's authority (task-baton askerOf). On a booted daemon with the real engine, tasks, runs, automations, mail, forms, members, access, Vault:
//   (a) a stranger's email, form and webhook each end in a turn for the runs-as person, audited as such; another person's republish makes them the runs-as; a suspended runs-as person leaves the
//       task waiting with the line; the agent's owner is never the asker; the agent owner's Mine item never reaches the agent's computer
//   (b) a Space Automation naming someone's Assistant is refused when saved, and when it runs (the agent became an Assistant after the save)
//   (c) a Personal Automation still runs as its owner   (d) a task a person assigns runs as that person
// The walks live in test/vault.turn-asker.a|b|c.live.test.ts; this file holds what they share and is not a test file.
import assert from "node:assert/strict";
import { boot, call, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

let keys = 0;
export const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `ta-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};
/** A call as one of the seeded people (the boot's session takes "Bearer usr_..."). */
export const okAs = async (d: Daemon, who: string, cap: string, input: Record<string, unknown>): Promise<any> => {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${who}` },
    body: JSON.stringify({ idempotencyKey: `ta-${who}-${++keys}`, ...input }),
  });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  assert.equal(r.status, 200, `${who} ${cap}: ${JSON.stringify(body)}`);
  return body.data;
};
export const PEOPLE = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah", "usr_sana", "usr_tess"];
export const refused = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<string> => {
  const r = await call(d, cap, { idempotencyKey: `ta-${cap}-${++keys}`, ...input });
  assert.notEqual(r.status, 200, `${cap} should be refused: ${JSON.stringify(r.data)}`);
  return String(r.data?.error?.message ?? "");
};
/** A model that only looks: it ends every turn without a tool. */
export const looks: OpenSession = async () =>
  ({
    warm: true,
    async *send(): AsyncGenerator<DriverEvent> {
      yield { type: "text", text: "I looked at it." };
      yield { type: "done" };
    },
    sendToolResult() {},
    inject() {},
    async cancel() {},
    async close() {},
  }) as EngineSession;
// a provider that answers its key check, so a Space-shared AI key can be added (no outside service is reached)
export const providerFetch = (async () =>
  new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as never;

export async function world() {
  // each seeded person signs in as themselves ("Bearer usr_..."); the daemon's own token is Olivia, as before
  const session = (h: Record<string, string | undefined>) => {
    const id = String(h["authorization"] ?? "").replace(/^Bearer /, "");
    return {
      space: "spc_core",
      principal: { kind: "person", id: PEOPLE.includes(id) ? id : "usr_olivia" },
      device: "mac",
    };
  };
  const d = await boot(seededDir(), looks, undefined, { providerFetch, session } as never);
  const pumping = setInterval(() => void d.hooks?.pump?.(), 100);
  await connect(d);
  const keyFolder = (await ok(d, "vault.folders.create", { name: "Team AI", scope: "shared" })).folder.id as string;
  const team = await ok(d, "providers.add", {
    providerKey: "openai",
    connection: "api_key",
    apiKey: "sk-test-turnasker-0123456789",
    scope: "shared",
    name: "Team OpenAI",
    folderId: keyFolder,
  }); // secret-scan: fake
  return {
    d,
    keyId: String(team.provider.id),
    keyItem: String(team.provider.itemId),
    stop: async () => {
      clearInterval(pumping);
      await d.stop();
    },
  };
}
export type World = Awaited<ReturnType<typeof world>>;
export const taskNode = (agentId: string, extra: Record<string, unknown> = {}) => ({
  id: "work",
  key: "ai",
  title: "Triage it",
  input: { prompt: "Triage the message.", outputSchema: { type: "object", properties: { note: { type: "string" } } } },
  ai: { mode: "task", agentId, doneMeans: ["Says who it is for"], ...extra },
});

/** A Space Automation (runs as svc_<id>) whose task-mode step hands the work to an agent, with the access an admin gives it. */
export async function spaceAutomation(w: World, trigger: Record<string, unknown>, agentId: string): Promise<string> {
  const made = await ok(w.d, "automations.create", {
    name: `Inbound ${String(trigger["key"])}`,
    definition: { triggers: [trigger], nodes: [taskNode(agentId)] },
  });
  const automationId = String(made.automation.id);
  await ok(w.d, "automations.promote", {
    automationId,
    confirm: true,
    replaceKeys: [{ stepId: "work", keyId: w.keyId }],
  });
  const serviceId = `svc_${automationId.slice(4)}`;
  await ok(w.d, "access.share", {
    resource: { type: "space", id: "spc_core" },
    subject: { kind: "service", id: serviceId },
    level: "edit",
  });
  await ok(w.d, "access.share", {
    resource: { type: "vault_item", id: w.keyItem },
    subject: { kind: "service", id: serviceId },
    level: "use",
  });
  await ok(w.d, "access.share", {
    resource: { type: "agent", id: agentId },
    subject: { kind: "service", id: serviceId },
    level: "use",
  });
  await ok(w.d, "automations.set_enabled", { automationId, enabled: true });
  return automationId;
}
export const runOf = (
  d: Daemon,
  automationId: string,
): { run_id: string; principal_kind: string; principal_id: string } | undefined =>
  d.db!.all(
    `SELECT run_id, principal_kind, principal_id FROM automations_runs WHERE automation_id = ? ORDER BY rowid DESC LIMIT 1`,
    automationId,
  )[0] as never;
export const turnsOf = (d: Daemon, agentId: string): string[] =>
  (
    d.db!.all("SELECT asker FROM engine_turns WHERE agent_id = ? ORDER BY rowid", agentId) as Array<{ asker: string }>
  ).map((r) => r.asker);
export async function taskOfRun(
  d: Daemon,
  runId: string,
): Promise<{ id: string; threadId?: string; createdBy?: string }> {
  return waitFor(
    async () =>
      (
        (await ok(d, "tasks.list", { scope: "run", runId })).tasks as Array<{
          id: string;
          threadId?: string;
          createdBy?: string;
        }>
      )[0] ?? null,
    30_000,
    () => hostLog(d),
  );
}

/** A model that does what the words it was handed say: when the brief asks to delete a folder, it tries. */
export function obeys(): { open: OpenSession; results: string[] } {
  const results: string[] = [];
  const open: OpenSession = async () => {
    const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
    return {
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        const all = (input.context?.sections ?? []).map((x) => x.text).join("\n");
        const id = /delete the Q3 folder (fld_[a-z0-9]+)/.exec(all)?.[1];
        if (!id) {
          yield { type: "text", text: "Nothing to do." };
          yield { type: "done" };
          return;
        }
        // a deferred tool is found first, as a real model does
        const found = new Promise<{ ok: boolean; content: unknown }>((resolve) => waiting.set("c0", resolve));
        yield { type: "tool_call", id: "c0", name: "tool_search", input: { query: "files_folder_delete" } };
        await found;
        const r = new Promise<{ ok: boolean; content: unknown }>((resolve) => waiting.set("c1", resolve));
        yield { type: "tool_call", id: "c1", name: "files_folder_delete", input: { folderId: id } };
        results.push("asked");
        const got = await r;
        results.push(JSON.stringify(got).slice(0, 400));
        yield { type: "text", text: "Done." };
        yield { type: "done" };
      },
      sendToolResult(callId: string, result: { ok: boolean; content: unknown }) {
        waiting.get(callId)?.(result);
      },
      inject() {},
      async cancel() {},
      async close() {},
    } as EngineSession;
  };
  return { open, results };
}

/** A model that does its work and hands it in on its own task (task_submit), with nothing risky. */
export function reports(): { open: OpenSession; results: string[] } {
  const results: string[] = [];
  const open: OpenSession = async () => {
    const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
    return {
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        const section = input.context?.sections.find((x) => x.id === "task")?.text ?? "";
        const taskId = /taskId (tsk_[a-z0-9]+)/.exec(section)?.[1];
        if (!taskId || !/it is your turn/.test(section)) {
          yield { type: "text", text: "Nothing for me." };
          yield { type: "done" };
          return;
        }
        const r = new Promise<{ ok: boolean; content: unknown }>((resolve) => waiting.set("s1", resolve));
        yield {
          type: "tool_call",
          id: "s1",
          name: "task_submit",
          input: { taskId, outputs: { note: "For sales" }, summary: "It is for sales" },
        };
        results.push(JSON.stringify(await r).slice(0, 400));
        yield { type: "text", text: "Handed in." };
        yield { type: "done" };
      },
      sendToolResult(callId: string, result: { ok: boolean; content: unknown }) {
        waiting.get(callId)?.(result);
      },
      inject() {},
      async cancel() {},
      async close() {},
    } as EngineSession;
  };
  return { open, results };
}

/** A model that, in an Automation's task, makes the calls the plan gives (finding each deferred tool first), then hands its task in. A held call waits there, as a real turn does. */
export function planned(
  plan: (q3: string | undefined) => Array<{ name: string; input: Record<string, unknown> }>,
  submit = true,
): { open: OpenSession; results: string[]; turns: number } {
  const out = { open: null as unknown as OpenSession, results: [] as string[], turns: 0 };
  out.open = async () => {
    const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
    let n = 0;
    const call = async function* (
      name: string,
      input: Record<string, unknown>,
    ): AsyncGenerator<DriverEvent, { ok: boolean; content: unknown }> {
      const id = `c${++n}`;
      const p = new Promise<{ ok: boolean; content: unknown }>((resolve) => waiting.set(id, resolve));
      yield { type: "tool_call", id, name, input };
      return await p;
    };
    return {
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        const all = (input.context?.sections ?? []).map((x) => x.text).join("\n");
        const section = input.context?.sections.find((x) => x.id === "task")?.text ?? "";
        const taskId = /taskId (tsk_[a-z0-9]+)/.exec(section)?.[1];
        if (!taskId || !/it is your turn/.test(section)) {
          yield { type: "text", text: "Nothing for me." };
          yield { type: "done" };
          return;
        }
        out.turns++;
        for (const c of plan(/(fld_[a-z0-9]+)/.exec(all)?.[1])) {
          yield* call("tool_search", { query: c.name });
          const r = yield* call(c.name, c.input);
          // 1500, not 300: a refusal now leads with the sentence a model says and the rule for reporting it, and the reason follows them
          out.results.push(`${c.name}:${JSON.stringify(r).slice(0, 1500)}`);
        }
        if (submit) {
          const r = yield* call("task_submit", { taskId, outputs: { note: "Done" }, summary: "Done" });
          out.results.push(`task_submit:${JSON.stringify(r).slice(0, 300)}`);
        }
        yield { type: "text", text: "Done." };
        yield { type: "done" };
      },
      sendToolResult(callId: string, result: { ok: boolean; content: unknown }) {
        waiting.get(callId)?.(result);
      },
      inject() {},
      async cancel() {},
      async close() {},
    } as EngineSession;
  };
  return out;
}

export async function webhookWorld(open: OpenSession) {
  const session = (h: Record<string, string | undefined>) => {
    const id = String(h["authorization"] ?? "").replace(/^Bearer /, "");
    return {
      space: "spc_core",
      principal: { kind: "person", id: PEOPLE.includes(id) ? id : "usr_olivia" },
      device: "mac",
    };
  };
  const d = await boot(seededDir(), open, undefined, { providerFetch, session } as never);
  const pumping = setInterval(() => void d.hooks?.pump?.(), 100);
  await connect(d);
  const keyFolder = (await ok(d, "vault.folders.create", { name: "Team AI", scope: "shared" })).folder.id as string;
  const team = await ok(d, "providers.add", {
    providerKey: "openai",
    connection: "api_key",
    apiKey: "sk-test-turnasker-0123456789",
    scope: "shared",
    name: "Team OpenAI",
    folderId: keyFolder,
  }); // secret-scan: fake
  const w = {
    d,
    keyId: String(team.provider.id),
    keyItem: String(team.provider.itemId),
    stop: async () => {
      clearInterval(pumping);
      await d.stop();
    },
  } as World;
  const tree = (await ok(d, "files.tree", {})) as { roots: Array<{ key: string; folderId?: string }> };
  const q3 = String(
    (
      await ok(d, "files.folder.create", {
        parentId: tree.roots.find((r) => r.key === "projects")!.folderId!,
        name: "Q3",
      })
    ).folder.folderId,
  );
  const agent = await newAgent(d, "Intake Desk");
  const hooked = await spaceAutomation(w, { key: "webhook" }, agent.id);
  const hook = (await ok(d, "automations.webhook_url.get", { automationId: hooked })) as { url?: string };
  const fire = async (text: string, key: string): Promise<string> => {
    const r = await fetch(`${d.url}${new URL(String(hook.url), d.url).pathname}`, {
      method: "POST",
      body: JSON.stringify({ text }),
      headers: { "content-type": "application/json", "idempotency-key": key },
    });
    assert.ok(r.status < 300, `webhook: ${r.status}`);
    return (
      await waitFor(
        async () =>
          (d.db!.all(
            `SELECT run_id FROM automations_runs WHERE automation_id = ? AND event_id = ?`,
            hooked,
            `hook:${key}`,
          )[0] as { run_id: string } | undefined) ?? null,
        30_000,
        () => hostLog(d),
      )
    ).run_id;
  };
  const status = async (runId: string): Promise<string> => String((await ok(d, "runs.get", { runId })).run.status);
  const cards = async (): Promise<string> => JSON.stringify(await okAs(d, "usr_olivia", "tasks.needs_you", {}));
  return { w, d, q3, agent, hooked, fire, status, cards };
}

/** A webhook Run whose text asks for one call: the call must stop with the card naming the automation, and its effect must not happen. */
export async function heldCase(
  name: string,
  input: (ctx: { agentId: string; q3: string; a?: string; b?: string }) => Record<string, unknown>,
  text: string,
  setup?: (x: Awaited<ReturnType<typeof webhookWorld>>) => Promise<{ a?: string; b?: string }>,
): Promise<Awaited<ReturnType<typeof webhookWorld>> & { results: string[] }> {
  const ctx: { agentId: string; q3: string; a?: string; b?: string } = { agentId: "", q3: "" };
  const m = planned(() => [{ name, input: input(ctx) }]);
  const x = await webhookWorld(m.open);
  ctx.agentId = x.agent.id;
  ctx.q3 = x.q3;
  Object.assign(ctx, setup ? await setup(x) : {});
  await x.fire(text, `hook-${name}`);
  const c = await waitFor(
    async () => {
      const s = await x.cards();
      return /Started by the automation/.test(s) ? s : null;
    },
    60_000,
    () => `${hostLog(x.d)} ${m.results.join(" / ")}`,
  );
  assert.match(c, /Started by the automation Inbound webhook \(webhook\)/, name);
  assert.equal(m.results.length, 0, `${name}: waiting on the card, not done`);
  return Object.assign(x, { results: m.results });
}
