// Golden flow 7, second half: the Gate on an agent's send (spec 2.14; ARCH 4.6). A person asks the agent to send an email; the send is an outward act, so the Gate holds it and an Approve task goes to the
// person; a wrong approval token releases nothing; the person approves and the send goes out once. A second send is left alone: its hold escalates, then expires and the send is dropped.
// Same engine setup as the first half (07-agent-reply.ts). The agent's send comes from the CLI calling the mail tool over the loopback MCP session.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { bootFlowSpace, expectStatus, short, Trail } from "./02-space.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_GATE_REPLY = ["vault", "engine", "agents", "files", "access", "devices", "tasks", "runs", "chat", "gate", "mail"];

/** Why this is a todo today. Each line names the PR it waits on. */
export const GATE_GAPS: Gap[] = [
  { packet: "L2 engine (steward)", lane: "L2", what: "the same as the reply half: the agent never answers the 'send pat@acme.test <mailbox>' message, so no mail_send reaches the Gate and no hold appears within 40 s" },
];

const TOKEN = "sk-ant-oat01-GOLDENFAKE0123456789abcdefXYZ"; // secret-scan: fake
type Hold = { id: string; taskId: string; state: string; capName?: string };

export async function runAgentGate(live: readonly string[], opts: Parameters<typeof bootFlowSpace>[1] = {}): Promise<{ events: Observed[]; trail: Trail }> {
  const s = await bootFlowSpace(live, opts);
  const trail = new Trail();
  try {
    const admin = s.d.token;
    const held = async (n: number): Promise<Hold> => {
      const end = Date.now() + 40_000;
      for (;;) {
        await s.d.hooks?.pump?.();
        const holds = expectStatus(await s.call("gate.holds.list", admin, { states: ["held"] }), 200, "gate.holds.list").holds as Hold[];
        if (holds.length >= n) return holds[n - 1]!;
        if (Date.now() > end) {
          s.d.sink.flush();
          const logs = new DatabaseSync(s.d.paths.logs, { readOnly: true }).prepare("SELECT level, place, cap, msg, attrs FROM logs WHERE level >= 30 OR msg LIKE '%consumer%' OR msg LIKE '%bridge%' OR msg LIKE '%engine%' ORDER BY id DESC LIMIT 30").all().map((r) => `${r.level} ${r.place ?? ""} ${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 300)}`);
          const rows = (sql: string): unknown => { try { return s.d.db?.all(sql); } catch (e) { return String(e); } };
          const agentsKnown = await s.call("access.principals.list", admin, { kind: "agent" }); const agentRow = await s.call("agents.list", admin, {});
          const said = (await s.call("chat.messages.list", admin, { threadId: thread! })).body?.data?.messages ?? [];
          throw new Error(`no hold ${n} after 40 s: ${short(holds)}; thread ${short(said)}; principals(agent) ${short(agentsKnown.body?.data ?? agentsKnown.body)}; agents ${short(agentRow.body?.data ?? agentRow.body)}; host log ${JSON.stringify(logs)}; diag ${JSON.stringify({ queue: rows("SELECT * FROM engine_thread_queue LIMIT 5"), unblock: rows("SELECT * FROM engine_unblock LIMIT 5") })}`);
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    };
    await trail.step("her person key is unlocked and her Claude account is in the Vault", async () => {
      const key = globalThis.crypto.getRandomValues(new Uint8Array(32));
      const res = await fetch(`${s.d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${admin}` }, body: JSON.stringify({ key: Buffer.from(key).toString("base64") }) });
      assert.equal(res.status, 204, `unlock: ${res.status}`);
      const folder = expectStatus(await s.call("vault.folders.create", admin, { idempotencyKey: "golden-7g-folder", name: "Accounts", scope: "mine" }), 200, "vault.folders.create").folder.id as string;
      const flow = expectStatus(await s.call("providers.subscription_start", admin, { idempotencyKey: "golden-7g-flow", providerKey: "claude-code" }), 200, "providers.subscription_start").flowId as string;
      expectStatus(await s.call("vault.item.put", admin, { idempotencyKey: "golden-7g-item", folderId: folder, name: "Olivia_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: TOKEN, secret: true }] }), 200, "vault.item.put");
      const provider = expectStatus(await s.call("providers.subscription_complete", admin, { flowId: flow }), 200, "providers.subscription_complete").provider as { id: string };
      expectStatus(await s.call("providers.set_space_use", admin, { idempotencyKey: "golden-7g-spaceuse", providerId: provider.id, allow: true }), 200, "providers.set_space_use");
    });
    const agent = await trail.step("an agent exists", async () => expectStatus(await s.call("agents.create", admin, { idempotencyKey: "golden-7g-agent", name: "Mailer", role: "Writes the weekly note" }), 200, "agents.create").agent.agentId as string);
    const thread = await trail.step("she starts a chat with it and the engine is bound", async () => {
      const id = expectStatus(await s.call("chat.start", admin, { idempotencyKey: "golden-7g-chat", kind: "chat", agentIds: [agent!] }), 200, "chat.start").thread.threadId as string;
      expectStatus(await s.call("engine.pool.status", admin, {}), 200, "engine.pool.status");
      return id;
    }, ["an agent exists"]);
    const mailbox = await trail.step("the agent has a mailbox to send from", async () => {
      const m = expectStatus(await s.call("mail.mailbox.create", admin, { idempotencyKey: "golden-7g-mailbox", kind: "agent", address: "mailer@seed.example.test", title: "Mailer", agentId: agent! }), 200, "mail.mailbox.create").mailbox;
      return (m.mailboxId ?? m.id) as string;
    }, ["an agent exists"]);
    const ask = (key: string) => async (): Promise<void> => {
      expectStatus(await s.call("chat.post", admin, { idempotencyKey: key, threadId: thread!, body: `send pat@acme.test ${mailbox!}`, mentions: [{ kind: "agent", id: agent! }] }), 200, "chat.post");
    };
    await trail.step("she asks it to send an email", ask("golden-7g-ask-1"), ["she starts a chat with it and the engine is bound", "the agent has a mailbox to send from"]);
    const first = await trail.step("the Gate holds the send and opens an Approve task for her", async () => {
      const h = await held(1);
      const t = expectStatus(await s.call("tasks.get", admin, { taskId: h.taskId }), 200, "tasks.get").task;
      assert.equal(t.kind, "approve", `task ${short(t)}`);
      return h;
    }, ["she asks it to send an email"]);
    await trail.step("refusal: a wrong approval token releases nothing", async () => {
      const r = await s.call("gate.release", admin, { holdId: first!.id, taskId: first!.taskId, approvalToken: "apv_wrong" });
      assert.ok(r.status >= 400 && r.status < 500, `gate.release with a bad token: ${r.status} ${short(r.body?.error ?? r.body)}`);
    }, ["the Gate holds the send and opens an Approve task for her"]);
    await trail.step("she approves and the send goes out once", async () => {
      expectStatus(await s.call("tasks.act", admin, { taskId: first!.taskId, action: "approve" }), 200, "tasks.act");
      const holds = expectStatus(await s.call("gate.holds.list", admin, { states: ["approved"] }), 200, "gate.holds.list").holds as Hold[];
      assert.equal(holds.filter((h) => h.id === first!.id).length, 1, `hold ${first!.id} approved once: ${short(holds)}`);
    }, ["the Gate holds the send and opens an Approve task for her"]);
    const second = await trail.step("a second send is held and left alone", async () => {
      await ask("golden-7g-ask-2")();
      return held(1);
    }, ["she approves and the send goes out once"]);
    await trail.step("with no decision the hold escalates", async () => {
      const out = expectStatus(await s.call("gate.expire", admin, { holdId: second!.id }), 200, "gate.expire");
      assert.equal(out.outcome, "escalated", `first timeout: ${short(out)}`);
    }, ["a second send is held and left alone"]);
    await trail.step("with still no decision it expires and the send is dropped", async () => {
      const out = expectStatus(await s.call("gate.expire", admin, { holdId: second!.id }), 200, "gate.expire");
      assert.equal(out.outcome, "dropped", `second timeout: ${short(out)}`);
    }, ["with no decision the hold escalates"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}
