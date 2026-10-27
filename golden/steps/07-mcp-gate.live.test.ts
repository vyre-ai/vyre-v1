// The daemon owns the raw /mcp mount. This proves a driver token can negotiate
// the protocol and reach the real invoke pipeline, where an agent mail send is
// parked by the Gate rather than hanging on an unmounted/default endpoint.
import test from "node:test";
import assert from "node:assert/strict";
import { expectStatus } from "./02-space.ts";
import { addVerifiedSendingDomain, allowAgentSending, bootAgentGateSpace, configureSendEscalation, LIVE_FOR_GATE_REPLY, makeHoldDue } from "./07-agent-gate.ts";

const hex = async (text: string): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, "0")).join("");

test("the daemon MCP endpoint initializes and an agent tool call reaches the Gate", async () => {
  const s = await bootAgentGateSpace(LIVE_FOR_GATE_REPLY);
  try {
    const admin = s.d.token;
    await addVerifiedSendingDomain(s, admin, "mcp-live");
    await configureSendEscalation(s, admin);
    const agent = expectStatus(await s.call("agents.create", admin, { idempotencyKey: "mcp-live-agent", name: "Mailer", role: "Writes mail" }), 200, "agents.create").agent.agentId as string;
    await allowAgentSending(s, admin, agent, "mcp-live");
    const thread = expectStatus(await s.call("chat.start", admin, { idempotencyKey: "mcp-live-chat", kind: "chat", agentIds: [agent] }), 200, "chat.start").thread.threadId as string;
    const made = expectStatus(await s.call("mail.mailbox.create", admin, { idempotencyKey: "mcp-live-mailbox", kind: "agent", address: "mcp-live@send.agent-gate.test", title: "Mailer", agentId: agent }), 200, "mail.mailbox.create").mailbox;
    const mailboxId = (made.mailboxId ?? made.id) as string;

    const token = "vys_mcp_live_driver_token_0123456789";
    s.d.db!.run(
      "INSERT INTO mcp_sessions (session_id, kind, token_hash, principal, acting_for, thread_id, trace_id, started_at, expires_at, calls) VALUES (?, 'driver', ?, ?, 'usr_olivia', ?, ?, ?, ?, 0)",
      "ses_mcp_live", await hex(token), agent, thread, "a".repeat(32), Date.now(), 9_999_999_999_999,
    );
    let sessionId = "";
    const rpc = async (body: unknown): Promise<{ status: number; json: any }> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await fetch(`${s.d.url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(sessionId ? { "mcp-session-id": sessionId } : {}) }, body: JSON.stringify(body) });
      sessionId = r.headers.get("mcp-session-id") ?? sessionId;
      const text = await r.text();
      return { status: r.status, json: text ? JSON.parse(text) : null };
    };
    const initialized = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-live", version: "1" } } });
    assert.equal(initialized.status, 200);
    assert.equal(sessionId, "ses_mcp_live");
    assert.equal((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
    const called = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "mail_send", arguments: { mailboxId, to: [{ address: "pat@acme.test" }], subject: "Hello", text: "From the agent", idempotencyKey: "mcp-live-send" } } });
    assert.equal(called.status, 200);
    assert.equal(called.json.result.isError, true);
    assert.equal(called.json.result.structuredContent.held, true);
    const holds = expectStatus(await s.call("gate.holds.list", admin, { states: ["held"] }), 200, "gate.holds.list").holds;
    assert.equal(holds.length, 1);
    assert.equal(holds[0].capName, "mail.send");
    expectStatus(await s.call("tasks.act", admin, { taskId: holds[0].taskId, action: "approve" }), 200, "tasks.act");
    const sent = expectStatus(await s.call("mail.message.list", admin, { mailboxId, direction: "out" }), 200, "mail.message.list").messages as { status: string }[];
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.status, "sent");

    const second = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mail_send", arguments: { mailboxId, to: [{ address: "pat@acme.test" }], subject: "Hello again", text: "A distinct turn", idempotencyKey: "mcp-live-send-2" } } });
    assert.equal(second.status, 200);
    assert.equal(second.json.result.structuredContent.held, true);
    const pending = expectStatus(await s.call("gate.holds.list", admin, { states: ["held"] }), 200, "gate.holds.list").holds;
    assert.equal(pending.length, 1);
    assert.notEqual(pending[0].id, holds[0].id);
    makeHoldDue(s, pending[0].id);
    assert.equal(expectStatus(await s.call("gate.expire", admin, { holdId: pending[0].id }), 200, "gate.expire").outcome, "escalated");
    makeHoldDue(s, pending[0].id);
    assert.equal(expectStatus(await s.call("gate.expire", admin, { holdId: pending[0].id }), 200, "gate.expire").outcome, "dropped");
    const unchanged = expectStatus(await s.call("mail.message.list", admin, { mailboxId, direction: "out" }), 200, "mail.message.list").messages;
    assert.equal(unchanged.length, 1);
  } finally { await s.stop(); }
});
