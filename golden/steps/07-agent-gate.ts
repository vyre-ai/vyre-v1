// Golden flow 7, second half: the Gate on an agent's send (spec 2.14; ARCH 4.6). A person asks the agent to send an email; the send is an outward act, so the Gate holds it and an Approve task goes to the
// person; a wrong approval token releases nothing; the person approves and the send goes out once. A second send is left alone: its hold escalates, then expires and the send is dropped.
// Same engine setup as the first half (07-agent-reply.ts). The agent's send comes from the CLI calling the mail tool over the loopback MCP session.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { bootFlowSpace, expectStatus, short, Trail } from "./02-space.ts";
import type { FlowSpace } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";
import { setDefaultDns } from "../../modules/mail/handlers/extra/dns.ts";
import type { FetchFn } from "../../host/src/platform/probes.ts";
import type { SeamFetch } from "../../host/src/seams/ports.ts";

export const LIVE_FOR_GATE_REPLY = ["vault", "engine", "agents", "files", "access", "devices", "tasks", "runs", "chat", "gate", "mail", "resend", "contacts-link"];

export const GATE_GAPS = [];

const TOKEN = "sk-ant-oat01-GOLDENFAKE0123456789abcdefXYZ"; // secret-scan: fake
const DOMAIN = "send.agent-gate.test";
type Hold = { id: string; taskId: string; state: string; capName?: string };

type NetFetch = FetchFn & SeamFetch;
type NetResponse = Awaited<ReturnType<FetchFn>> & Awaited<ReturnType<SeamFetch>>;
const json = (status: number, body: unknown): Promise<NetResponse> => Promise.resolve({
  ok: status < 300, status, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify(body)),
  arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(body)).buffer as ArrayBuffer),
});

/** Flow 7 crosses the provider boundary after approval, so its fake includes
 * the same verified-domain precondition production requires. */
export async function bootAgentGateSpace(live: readonly string[], opts: Parameters<typeof bootFlowSpace>[1] = {}): Promise<FlowSpace> {
  const zone = new Map<string, string[]>();
  const miss = (): never => { throw Object.assign(new Error("no data"), { code: "ENODATA" }); };
  setDefaultDns({
    txt: (name) => Promise.resolve(zone.get(name.toLowerCase()) ?? miss()),
    cname: () => Promise.resolve(miss()),
    mx: () => Promise.resolve(miss()),
  });
  let sent = 0;
  const provider: NetFetch = (url, init) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    if (u.host !== "api.resend.com") return json(200, { apps: { http: {} } });
    if (u.pathname === "/emails" && method === "POST") return json(200, { id: `re_gate_${++sent}` });
    if (u.pathname === "/domains" && method === "POST") {
      const records = [
        { record: "SPF", type: "TXT", name: DOMAIN, value: "v=spf1 include:amazonses.com ~all", status: "not_started" },
        { record: "DKIM", type: "TXT", name: `resend._domainkey.${DOMAIN}`, value: "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDfake", status: "not_started" },
      ];
      for (const record of records) zone.set(record.name, [record.value]);
      zone.set(`_dmarc.${DOMAIN}`, ["v=DMARC1; p=none"]);
      return json(200, { id: "dom_gate", name: DOMAIN, status: "not_started", records });
    }
    if (u.pathname.endsWith("/verify") && method === "POST") return json(200, { id: "dom_gate" });
    if (u.pathname.startsWith("/domains/") && method === "GET") return json(200, {
      id: "dom_gate", name: DOMAIN, status: "verified", records: [
        { record: "SPF", type: "TXT", name: DOMAIN, value: "v=spf1 include:amazonses.com ~all", status: "verified" },
        { record: "DKIM", type: "TXT", name: `resend._domainkey.${DOMAIN}`, value: "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDfake", status: "verified" },
      ],
    });
    return json(200, { data: [] });
  };
  return bootFlowSpace(live, {
    ...opts,
    fetch: opts.fetch ?? provider,
    vault: opts.vault ?? { secret: async (handle) => `fake-${handle.replace(/^#/, "")}`, signRs256: async () => "" },
  });
}

export async function addVerifiedSendingDomain(s: FlowSpace, admin: string, key: string): Promise<void> {
  const added = expectStatus(await s.call("mail.domain.add", admin, {
    idempotencyKey: `${key}-domain`, name: DOMAIN, provider: "resend",
  }), 200, "mail.domain.add");
  const id = (added.domain?.id ?? added.domainId ?? added.id) as string;
  const checked = expectStatus(await s.call("mail.domain.check", admin, { domainId: id }), 200, "mail.domain.check");
  assert.equal((checked.domain ?? checked).verified, true, `the domain verifies: ${short(checked)}`);
}

export async function configureSendEscalation(s: FlowSpace, admin: string): Promise<void> {
  expectStatus(await s.call("gate.rules.set", admin, {
    act: "send", scope: "space", mode: "hold", onTimeout: "escalate", escalateTo: "role",
  }), 200, "gate.rules.set");
}

/** FlowSpace has a fixed production-like clock. Move only this test hold to its
 * scheduled instant before exercising the scheduler-owned expiry capability. */
export function makeHoldDue(s: FlowSpace, holdId: string): void {
  s.d.db!.run("UPDATE gate_holds SET expires_at = 0 WHERE id = ?", holdId);
}

/** Agent sends are high-risk: the asker must explicitly give the agent an
 * assignable role carrying comms.agent_send before Gate approval can resume it. */
export async function allowAgentSending(s: FlowSpace, admin: string, agent: string, key: string): Promise<void> {
  const made = expectStatus(await s.call("access.roles.create", admin, {
    idempotencyKey: `${key}-role`, name: `Agent sender ${agent.slice(-6)}`, cloneFrom: "rol_guest", assignableToAgents: true,
  }), 200, "access.roles.create").role as { id: string };
  const preview = expectStatus(await s.call("access.roles.preview", admin, {
    roleId: made.id, permissions: ["comms.agent_send"],
  }), 200, "access.roles.preview") as { previewHash: string };
  expectStatus(await s.call("access.roles.apply", admin, {
    roleId: made.id, permissions: ["comms.agent_send"], previewHash: preview.previewHash,
  }), 200, "access.roles.apply");
  expectStatus(await s.call("access.roles.assign", admin, {
    subject: { kind: "agent", id: agent }, roleId: made.id,
  }), 200, "access.roles.assign");
}

export async function runAgentGate(live: readonly string[], opts: Parameters<typeof bootFlowSpace>[1] = {}): Promise<{ events: Observed[]; trail: Trail }> {
  const s = await bootAgentGateSpace(live, opts);
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
          throw new Error(`no hold ${n} after 40 s: ${short(holds)}; principals(agent) ${short(agentsKnown.body?.data ?? agentsKnown.body)}; agents ${short(agentRow.body?.data ?? agentRow.body)}; host log ${JSON.stringify(logs)}; diag ${JSON.stringify({ queue: rows("SELECT * FROM engine_thread_queue LIMIT 5"), unblock: rows("SELECT * FROM engine_unblock LIMIT 5") })}`);
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
    await trail.step("a sending domain is added and verifies", async () => addVerifiedSendingDomain(s, admin, "golden-7g"));
    await trail.step("unanswered sends escalate to the admin role", async () => configureSendEscalation(s, admin));
    const agent = await trail.step("an agent exists", async () => expectStatus(await s.call("agents.create", admin, { idempotencyKey: "golden-7g-agent", name: "Mailer", role: "Writes the weekly note" }), 200, "agents.create").agent.agentId as string);
    await trail.step("she allows the agent to send outside", async () => allowAgentSending(s, admin, agent!, "golden-7g"), ["an agent exists"]);
    const thread = await trail.step("she starts a chat with it and the engine is bound", async () => {
      const id = expectStatus(await s.call("chat.start", admin, { idempotencyKey: "golden-7g-chat", kind: "chat", agentIds: [agent!] }), 200, "chat.start").thread.threadId as string;
      expectStatus(await s.call("engine.pool.status", admin, {}), 200, "engine.pool.status");
      return id;
    }, ["an agent exists", "she allows the agent to send outside"]);
    const mailbox = await trail.step("the agent has a mailbox to send from", async () => {
      const m = expectStatus(await s.call("mail.mailbox.create", admin, { idempotencyKey: "golden-7g-mailbox", kind: "agent", address: `mailer@${DOMAIN}`, title: "Mailer", agentId: agent! }), 200, "mail.mailbox.create").mailbox;
      return (m.mailboxId ?? m.id) as string;
    }, ["an agent exists", "a sending domain is added and verifies"]);
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
      makeHoldDue(s, second!.id);
      const out = expectStatus(await s.call("gate.expire", admin, { holdId: second!.id }), 200, "gate.expire");
      assert.equal(out.outcome, "escalated", `first timeout: ${short(out)}`);
    }, ["a second send is held and left alone"]);
    await trail.step("with still no decision it expires and the send is dropped", async () => {
      makeHoldDue(s, second!.id);
      const out = expectStatus(await s.call("gate.expire", admin, { holdId: second!.id }), 200, "gate.expire");
      assert.equal(out.outcome, "dropped", `second timeout: ${short(out)}`);
    }, ["with no decision the hold escalates"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}
