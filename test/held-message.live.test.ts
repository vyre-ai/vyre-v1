// A held message is one card, and the person can edit it before it goes (lane l-chrome2a). Mia's agent holds a direct message to Noah on a booted daemon; Mia reads it as Gate's card with the
// recipient and the words (no internal fields), edits it, and presses Send: Noah reads her edited text, once, and the agent is told it went. A second hold is refused with a reason: nothing
// reaches Noah and the agent hears the reason. Real chats, Gate and tasks; only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY, boot, connect, hostLog, scriptedModel, seededDir, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const WHO = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah"];
type Msg = { author?: { kind?: string; id?: string }; kind?: string; body?: string; blocks?: Array<{ type: string; data?: Record<string, unknown> }> };

const as = (d: Daemon) => async (who: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const b = (await r.json()) as { data?: unknown };
  return { status: r.status, data: b.data ?? b };
};

test("Team: a held message to Noah shows his name and the words; Mia edits it and Send delivers her words; Don't send with a reason reaches the agent", async () => {
  const resumed: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    if (input.resumed?.toolName === "message_person") {
      resumed.push(`${input.resumed.approved}:${JSON.stringify(input.resumed.result.content).slice(0, 400)}`);
      yield { type: "text", text: input.resumed.approved ? "Sent it." : `Not sent: ${JSON.stringify(input.resumed.result.content).slice(0, 300)}` };
      return;
    }
    const said = input.trigger?.body ?? "";
    if (/^check with Noah about (Friday|Monday)/.test(said)) {
      const friday = /Friday/.test(said);
      yield* run("message_person", { to: "usr_noah", body: friday ? "**Friday** works?\n\n- the Rivera draft\n- the invoice" : "Monday works?", idempotencyKey: friday ? "hm-1" : "hm-2" });
    }
  });
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "held-message" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  const list = async (who: string, threadId: string): Promise<Msg[]> => { await d.hooks?.pump?.(); return ((await api(who, "chat.messages.list", { threadId })).data.messages as Msg[] | undefined) ?? []; };
  try {
    await connect(d);
    const agentId = (await api("usr_olivia", "agents.create", { name: "Ops", role: "You help the team.", idempotencyKey: "hm-agent" })).data.agent.agentId as string;
    const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "hm-ai", name: "AI accounts", scope: "shared" });
    const acct = await api("usr_olivia", "providers.add", { idempotencyKey: "hm-acct", providerKey: "anthropic", connection: "api_key", apiKey: `${KEY}A`, name: "Team AI", scope: "shared", folderId: keys.data.folder.id });
    assert.equal((await api("usr_olivia", "agents.update", { agentId, patch: { accountPolicy: "key", accountKey: acct.data.provider.handle }, idempotencyKey: "hm-upd" })).status, 200);
    const chat = (await api("usr_mia", "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "hm-chat" })).data.thread.threadId as string;
    const say = (body: string, k: string) => api("usr_mia", "chat.post", { threadId: chat, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: k });
    // a Space agent (not a person's own Assistant) writes as itself, in its own chat with the teammate (owner ruling 4 Nov): Noah reads what it sent in whichever of his chats it is
    const noahSees = async (): Promise<Msg[]> => {
      await d.hooks?.pump?.();
      const threads = ((await api("usr_noah", "threads.list", { kind: ["chat"], limit: 50 })).data.threads ?? []) as Array<{ threadId: string }>;
      return (await Promise.all(threads.map((t) => list("usr_noah", t.threadId)))).flat();
    };
    const cardOf = async (not: string[]): Promise<string> => waitFor(async () => (await list("usr_mia", chat)).flatMap((m) => m.blocks ?? []).filter((b) => b.type === "link_card" && b.data?.["icon"] === "approval").map((b) => String((b.data?.["target"] as { id?: string }).id)).find((id) => !not.includes(id)) ?? null, 30_000, () => hostLog(d));

    // 1. the hold: the card names Noah, carries the words as markdown, and nothing went yet
    await say("check with Noah about Friday", "hm-p1");
    const t1 = await cardOf([]);
    const task = (await api("usr_mia", "tasks.get", { taskId: t1 })).data.task as { blocks: Array<{ type: string; data?: Record<string, any> }> };   // eslint-disable-line @typescript-eslint/no-explicit-any
    const block = task.blocks.find((b) => b.data?.["outward"]);
    const out = block?.data?.["outward"] as { channel: string; to: Array<{ id?: string }>; body: string } | undefined;
    assert.ok(out, "the card carries the message in a person's words");
    assert.equal(out!.channel, "message");
    assert.equal(out!.to[0]?.id, "usr_noah");
    assert.equal(out!.body, "**Friday** works?\n\n- the Rivera draft\n- the invoice");
    assert.ok(!/online/.test(JSON.stringify(out)), "no internal field leaks");
    const holdId = String(block!.data!["holdId"]);
    assert.equal((await noahSees()).length, 0, "nothing went yet");

    // 2. Mia edits it: still held, marked edited; only she may
    const edit = await api("usr_mia", "gate.holds.revise", { holdId, taskId: t1, body: "Friday at 3 works?\n\n- the Rivera draft" });
    assert.equal(edit.status, 200, JSON.stringify(edit.data));
    assert.notEqual((await api("usr_noah", "gate.holds.revise", { holdId, taskId: t1, body: "hijack" })).status, 200, "only the person it is for edits it");
    assert.equal((await noahSees()).length, 0, "still held after the edit");
    const again = (await api("usr_mia", "tasks.get", { taskId: t1 })).data.task as { blocks: Array<{ data?: Record<string, any> }> };   // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.ok(again.blocks.some((b) => b.data?.["outward"]?.edited), "the card says edited");

    // 3. Send: Noah reads the edited words, once
    assert.equal((await api("usr_mia", "tasks.act", { taskId: t1, action: "approve" })).status, 200);
    const got = await waitFor(async () => (await noahSees()).find((m) => /Friday at 3/.test(m.body ?? "")) ?? null, 30_000, () => hostLog(d));
    assert.equal(got.body, "Friday at 3 works?\n\n- the Rivera draft");
    await waitFor(async () => resumed.length >= 1 ? true : null, 30_000, () => hostLog(d));
    assert.match(resumed[0]!, /^true:/);
    assert.ok(!(await noahSees()).some((m) => /\*\*Friday\*\* works/.test(m.body ?? "")), "the first wording never went");

    // 4. Don't send, with a reason: nothing reaches Noah and the agent hears why
    await say("check with Noah about Monday", "hm-p2");
    const t2 = await cardOf([t1]);
    assert.equal((await api("usr_mia", "tasks.act", { taskId: t2, action: "reject", note: "Ask Adam first, not Noah." })).status, 200);
    await waitFor(async () => resumed.length >= 2 ? true : null, 30_000, () => hostLog(d));
    assert.match(resumed[1]!, /^false:.*Ask Adam first, not Noah\./);
    assert.ok(!(await noahSees()).some((m) => /Monday works/.test(m.body ?? "")), "nothing went");
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); console.error("RESUMED", JSON.stringify(resumed)); throw e; } finally { await stop(d); }
});
