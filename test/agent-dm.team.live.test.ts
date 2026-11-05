// An agent messages a teammate for its person, two members on a booted daemon (lane l-agentdm). Mia asks her agent "tell Noah ...": it goes at once into Mia's own direct chat with Noah, signed for
// Mia; Noah's reply comes back to Mia's chat and the agent carries on there. Asked for nothing, the agent's message waits on a "Send this to Noah?" card that Mia approves with one press. An approval
// card goes to Adam, he approves it in place and the agent resumes. A private profile fact never leaves. Real chats, Gate and tasks; only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY, boot, connect, hostLog, scriptedModel, seededDir, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const WHO = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah"];
const FACT = "Mia has a cardiologist appointment every Thursday";
type Msg = { messageId: string; author?: { kind?: string; id?: string }; kind?: string; body?: string; blocks?: Array<{ type: string; data?: Record<string, unknown> }> };

const as = (d: Daemon) => async (who: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const b = (await r.json()) as { data?: unknown };
  return { status: r.status, data: b.data ?? b };
};

test("Team: Mia's agent messages Noah for her; his reply comes back; asked for nothing it asks Mia first (a tap or a plain yes); Adam approves a card; nothing private leaves", async () => {
  const results: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    const said = input.trigger?.body ?? "";
    // the wake after Mia pressed Allow on the card: the held call's answer
    if (input.resumed?.toolName === "message_person") {
      results.push(`resumed:${input.resumed.approved}:${input.resumed.result.ok}`);
      yield { type: "text", text: input.resumed.result.ok ? "Asked Noah about Friday." : `NOT SENT ${JSON.stringify(input.resumed.result.content).slice(0, 300)}` };
      return;
    }
    if (/^tell Noah the Rivera draft/.test(said)) {
      const r = yield* run("message_person", { to: "usr_noah", body: "The Rivera draft is ready for your review.", idempotencyKey: "live-dm-1" });
      results.push(`asked:${r.ok}`);
      yield { type: "text", text: r.ok ? "Sent to Noah." : `FAILED ${JSON.stringify(r.content).slice(0, 300)}` };
    } else if (/^check whether Noah/.test(said)) {
      const next = /next week/.test(said);
      const r = yield* run("message_person", { to: "usr_noah", body: next ? "Are you free next week?" : "Are you free on Friday afternoon?", idempotencyKey: next ? "live-dm-2b" : "live-dm-2" });
      results.push(`unasked:${r.ok}`);
      yield { type: "text", text: r.ok ? "Asked Noah about Friday." : `NOT SENT ${JSON.stringify(r.content).slice(0, 300)}` };
    } else if (/^ask Adam to approve/.test(said)) {
      const r = yield* run("message_person", { to: "usr_adam", body: "Can you approve the 10% Rivera discount?", card: { kind: "approval", title: "the 10% Rivera discount" }, idempotencyKey: "live-dm-3" });
      results.push(`card:${r.ok}`);
      yield { type: "text", text: r.ok ? "Asked Adam to approve." : `FAILED ${JSON.stringify(r.content).slice(0, 300)}` };
    } else if (/^tell Noah why/.test(said)) {
      const r = yield* run("message_person", { to: "usr_noah", body: `${FACT}, so Thursday does not work.`, idempotencyKey: "live-dm-4" });
      results.push(`private:${r.ok}`);
      yield { type: "text", text: r.ok ? "Sent the reason." : "I left it out: it is private." };
    } else if (/^Noah replied: /.test(said)) {
      yield { type: "text", text: `Noah answered: ${said.slice("Noah replied: ".length)}` };
    } else if (/^Adam approved: /.test(said)) {
      yield { type: "text", text: "Adam approved the discount. Carrying on with the letter." };
    }
  });
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "agentdm-team" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  const list = async (who: string, threadId: string): Promise<Msg[]> => { await d.hooks?.pump?.(); return ((await api(who, "chat.messages.list", { threadId })).data.messages as Msg[] | undefined) ?? []; };
  const agentSaid = (threadId: string, re: RegExp) => waitFor(async () => (await list("usr_mia", threadId)).find((m) => m.author?.kind === "agent" && re.test(m.body ?? "")) ?? null, 30_000, () => hostLog(d));
  try {
    await connect(d);
    const agentId = (await api("usr_olivia", "agents.create", { name: "Ops", role: "You help the team.", ownerId: "usr_mia", idempotencyKey: "dm-agent" })).data.agent.agentId as string;
    const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "dm-ai", name: "AI accounts", scope: "shared" });
    const acct = await api("usr_olivia", "providers.add", { idempotencyKey: "dm-acct", providerKey: "anthropic", connection: "api_key", apiKey: `${KEY}A`, name: "Team AI", scope: "shared", folderId: keys.data.folder.id });
    assert.equal((await api("usr_olivia", "agents.update", { agentId, patch: { accountPolicy: "key", accountKey: acct.data.provider.handle }, idempotencyKey: "dm-upd" })).status, 200);
    // this test is about an Assistant writing for its person: Ops is Mia's and stands in as her Assistant (a Space agent writes as itself, test/agent-dm.self.live.test.ts)
    { const { DatabaseSync } = await import("node:sqlite"); const db = new DatabaseSync(d.paths.modules); db.prepare("UPDATE agents_agent SET kind = 'assistant' WHERE id = ?").run(agentId); db.close(); }

    // Mia's own chat with the agent (Auto, the default)
    const chat = (await api("usr_mia", "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "dm-chat" })).data.thread.threadId as string;
    const say = (body: string, k: string) => api("usr_mia", "chat.post", { threadId: chat, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: k });

    // 1. asked this turn: it goes at once, into Mia's direct chat with Noah, signed for Mia
    await say("tell Noah the Rivera draft is ready", "p1");
    await agentSaid(chat, /^Sent to Noah\./);
    const dm = (await api("usr_mia", "chat.start", { kind: "chat", agentIds: [], personId: "usr_noah", idempotencyKey: "dm-open" })).data.thread.threadId as string;
    const first = (await list("usr_noah", dm)).find((m) => /Rivera draft is ready/.test(m.body ?? ""));
    assert.ok(first, "Noah reads it in his direct chat with Mia");
    assert.equal(first!.author?.id, agentId);
    assert.deepEqual(first!.blocks?.find((b) => b.type === "on_behalf")?.data, { person: "usr_mia", agentId, teammate: "usr_noah" }, "credited to Mia (Agent)");

    // 2. Noah's reply comes back to Mia's chat and the agent carries on there
    assert.equal((await api("usr_noah", "chat.post", { threadId: dm, body: "Thanks, I will read it tonight.", idempotencyKey: "n1" })).status, 200);
    await agentSaid(chat, /^Noah answered: Thanks, I will read it tonight\./);
    const relay = (await list("usr_mia", chat)).find((m) => m.kind === "quiet" && /^Noah replied: /.test(m.body ?? ""));
    assert.equal(relay?.author?.id, "usr_mia", "the line is Mia's chat's own, as Mia, waking her agent");

    // 3. asked for nothing: a "Send this to Noah?" card in Mia's chat; one press sends it and the agent carries on
    await say("check whether Noah is around this week", "p2");
    const card = await waitFor(async () => (await list("usr_mia", chat)).flatMap((m) => m.blocks ?? []).find((b) => b.type === "link_card" && b.data?.["icon"] === "approval") ?? null, 30_000, () => hostLog(d));
    const taskId = String((card.data?.["target"] as { id?: string }).id);
    assert.equal((await list("usr_noah", dm)).filter((m) => /Friday afternoon/.test(m.body ?? "")).length, 0, "nothing went before Mia said yes");
    const yes = await api("usr_mia", "tasks.act", { taskId, action: "approve" });
    assert.equal(yes.status, 200, JSON.stringify(yes.data));
    await waitFor(async () => (await list("usr_noah", dm)).find((m) => /Friday afternoon/.test(m.body ?? "")) ?? null, 30_000, () => hostLog(d));
    await agentSaid(chat, /^Asked Noah about Friday\./);

    // 3b. the same card answered in words: Mia's plain "yes, send it" presses it, the card shows it was sent and approved in chat
    await say("check whether Noah is around next week", "p2b");
    const card2 = await waitFor(async () => (await list("usr_mia", chat)).flatMap((m) => m.blocks ?? []).filter((b) => b.type === "link_card" && b.data?.["icon"] === "approval").map((b) => String((b.data?.["target"] as { id?: string }).id)).find((id) => id !== taskId) ?? null, 30_000, () => hostLog(d));
    assert.equal((await api("usr_mia", "chat.post", { threadId: chat, body: "yes, send it", idempotencyKey: "p2b-yes" })).status, 200);
    await waitFor(async () => (await list("usr_noah", dm)).find((m) => /free next week/.test(m.body ?? "")) ?? null, 30_000, () => hostLog(d));
    const t2 = (await api("usr_mia", "tasks.get", { taskId: card2 })).data.task as { state: string; workingNotes: Record<string, string> };
    assert.equal(t2.state, "done", "the card shows what happened");
    assert.equal(t2.workingNotes["approved_in"], "chat");
    assert.equal((await list("usr_noah", dm)).filter((m) => /free next week/.test(m.body ?? "")).length, 1, "sent once");

    // 4. an approval card: Adam approves it in place (Noah has had his 3 agent messages this hour), the answer goes back and the agent resumes
    await say("ask Adam to approve the Rivera discount", "p3");
    await agentSaid(chat, /^Asked Adam to approve\./);
    const dmAdam = (await api("usr_mia", "chat.start", { kind: "chat", agentIds: [], personId: "usr_adam", idempotencyKey: "dm-open-adam" })).data.thread.threadId as string;
    assert.equal((await list("usr_adam", dmAdam)).filter((m) => /10% Rivera discount/.test(m.body ?? "")).length, 0, "the card alone, its words not said twice");
    const inDm = await waitFor(async () => (await list("usr_adam", dmAdam)).flatMap((m) => m.blocks ?? []).find((b) => b.type === "link_card" && b.data?.["lead"] === "Allow") ?? null, 30_000, () => hostLog(d));
    const approveId = String((inDm.data?.["target"] as { id?: string }).id);
    const noahTasks = (await api("usr_adam", "tasks.list", { scope: "mine", kinds: ["approve"] })).data.tasks as Array<{ id: string }>;
    assert.ok(noahTasks.some((t) => t.id === approveId), "the Approve task is Adam's");
    assert.notEqual((await api("usr_mia", "tasks.act", { taskId: approveId, action: "approve" })).status, 200, "Mia cannot approve Adam's card");
    assert.equal((await api("usr_adam", "tasks.act", { taskId: approveId, action: "approve" })).status, 200);
    await agentSaid(chat, /^Adam approved the discount\. Carrying on/);

    // 5. a private profile fact of Mia's never reaches Noah
    assert.equal((await api("usr_mia", "memory.remember", { text: FACT, layer: "person" })).status, 200);
    await say("tell Noah why I cannot do Thursdays", "p4");
    await agentSaid(chat, /I left it out: it is private\./);
    const all = JSON.stringify(await list("usr_noah", dm));
    assert.ok(!all.includes("cardiologist"), "the fact is not in Noah's chat");
    assert.deepEqual(results.filter((r) => !r.startsWith("resumed")), ["asked:true", "card:true", "private:false"]);
    assert.ok(results.includes("resumed:true:true"), `the parked call woke with the answer: ${JSON.stringify(results)}`);
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 300) : e); console.error("RESULTS", JSON.stringify(results)); throw e; } finally { await stop(d); }
});
