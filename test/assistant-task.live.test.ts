// A person's own Assistant works and completes a task assigned to that person (lane l-chrome2a), on a booted daemon. Mia's task is assigned to Mia; in its thread she says "Get this done please", and the
// agent is told the task is hers to do for her (the "Your task" section), holds a message to Noah on the card, and after Mia presses Send hands the task in: it is Done and the thread reads
// "Ops did this for <Mia>". Noah's chat with the same agent cannot touch Mia's task. Real chats, Gate and tasks; only the model is scripted.
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

test("Team: the Assistant completes Mia's own task for her, with the send held on the card; Noah's use of the agent cannot", async () => {
  const sections: string[] = [];
  const refusal: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    const section = input.context?.sections.find((s) => s.id === "task")?.text ?? "";
    const taskId = /taskId (tsk_[a-z0-9]+)/.exec(section)?.[1];
    if (input.resumed?.toolName === "message_person") {
      yield* run("task_submit", { taskId: /tsk_[a-z0-9]+/.exec(JSON.stringify(input.context?.sections ?? []))?.[0], outputs: {}, summary: "Sent Noah the figures and closed this" });
      yield { type: "text", text: "Done." };
      return;
    }
    const said = input.trigger?.body ?? "";
    if (/^Get this done/.test(said) && taskId) {
      sections.push(section);
      yield* run("message_person", { to: "usr_noah", body: "The figures are ready.", idempotencyKey: "at-1" });
    } else if (/^Try Mia's task/.test(said)) {
      const id = said.slice("Try Mia's task ".length).trim();
      const r = yield* run("task_submit", { taskId: id, outputs: {}, summary: "I did it" });
      refusal.push(r.ok ? "ALLOWED" : "refused");
      yield { type: "text", text: r.ok ? "Done." : "I cannot." };
    }
  });
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "assistant-task" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  const list = async (who: string, threadId: string): Promise<Msg[]> => { await d.hooks?.pump?.(); return ((await api(who, "chat.messages.list", { threadId })).data.messages as Msg[] | undefined) ?? []; };
  try {
    await connect(d);
    const agentId = (await api("usr_olivia", "agents.create", { name: "Ops", role: "You help the team.", idempotencyKey: "at-agent" })).data.agent.agentId as string;
    const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "at-ai", name: "AI accounts", scope: "shared" });
    const acct = await api("usr_olivia", "providers.add", { idempotencyKey: "at-acct", providerKey: "anthropic", connection: "api_key", apiKey: `${KEY}A`, name: "Team AI", scope: "shared", folderId: keys.data.folder.id });
    assert.equal((await api("usr_olivia", "agents.update", { agentId, patch: { accountPolicy: "key", accountKey: acct.data.provider.handle }, idempotencyKey: "at-upd" })).status, 200);

    // Mia's task, assigned to Mia, and its thread with the agent in it
    const made = await api("usr_mia", "tasks.create", { title: "Send Noah the figures", assigned: { kind: "person", id: "usr_mia" }, idempotencyKey: "at-task" });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const taskId = made.data.task.id as string;
    const thread = (await api("usr_mia", "chat.start", { kind: "chat", agentIds: [agentId], scopeType: "task", scopeId: taskId, idempotencyKey: "at-thread" })).data.thread.threadId as string;
    assert.equal((await api("usr_mia", "chat.post", { threadId: thread, body: "Get this done please", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "at-go" })).status, 200);

    // the agent was told it is hers to do for her, and the send waits on the card
    const card = await waitFor(async () => (await list("usr_mia", thread)).flatMap((m) => m.blocks ?? []).find((b) => b.type === "link_card" && b.data?.["icon"] === "approval") ?? null, 30_000, () => hostLog(d));
    assert.match(sections[0] ?? "", /who is the person asking you, so doing it is yours to do for them/);
    assert.doesNotMatch(sections[0] ?? "", /You are not a seat/);
    const approvalId = String((card.data?.["target"] as { id?: string }).id);
    // the baton moved when she said go: Doing, with the agent named as on it for her
    const during = (await api("usr_mia", "tasks.get", { taskId })).data.task as { state: string; workingNotes: Record<string, string> };
    assert.equal(during.state, "doing");
    assert.equal(during.workingNotes["baton.on_it"], agentId);
    const dm = (await api("usr_mia", "chat.start", { kind: "chat", agentIds: [], personId: "usr_noah", idempotencyKey: "at-dm" })).data.thread.threadId as string;
    assert.equal((await list("usr_noah", dm)).filter((m) => /figures/.test(m.body ?? "")).length, 0, "nothing went before Mia pressed Send");
    assert.equal((await api("usr_mia", "tasks.act", { taskId: approvalId, action: "approve" })).status, 200);
    // a Space agent writes as itself: Noah reads the figures in the agent's own chat with him, not in Mia's chat with him
    await waitFor(async () => {
      await d.hooks?.pump?.();
      const recent = (await api("usr_noah", "chat.recent", { filter: "all" })).data as Record<string, Array<{ threadId: string }> | undefined>;
      for (const t of [...(recent["today"] ?? []), ...(recent["yesterday"] ?? []), ...(recent["earlier"] ?? [])]) {
        const hit = (await list("usr_noah", t.threadId)).find((m) => /figures are ready/.test(m.body ?? ""));
        if (hit) return hit;
      }
      return null;
    }, 30_000, () => hostLog(d));

    // then the task is handed in for her: Done, and the line names who did it for whom
    await waitFor(async () => ((await api("usr_mia", "tasks.get", { taskId })).data.task.state === "done" ? true : null), 30_000, () => hostLog(d));
    const said = await waitFor(async () => (await list("usr_mia", thread)).find((m) => /did this for/.test(m.body ?? "")) ?? null, 30_000, () => hostLog(d));
    assert.match(said.body ?? "", /^Ops did this for .+\.\n\nSubmitted: Sent Noah the figures/);

    // Noah, using the same agent in his own chat, cannot hand in Mia's task
    const other = await api("usr_mia", "tasks.create", { title: "Mia's other task", assigned: { kind: "person", id: "usr_mia" }, idempotencyKey: "at-task2" });
    const chat = (await api("usr_noah", "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "at-noah" })).data.thread.threadId as string;
    assert.equal((await api("usr_noah", "chat.post", { threadId: chat, body: `Try Mia's task ${other.data.task.id}`, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "at-try" })).status, 200);
    await waitFor(async () => (refusal.length > 0 ? true : null), 30_000, () => hostLog(d));
    assert.deepEqual(refusal, ["refused"]);
    assert.equal((await api("usr_mia", "tasks.get", { taskId: other.data.task.id })).data.task.state, "todo");
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); console.error("SECTIONS", JSON.stringify(sections).slice(0, 600)); throw e; } finally { await stop(d); }
});
