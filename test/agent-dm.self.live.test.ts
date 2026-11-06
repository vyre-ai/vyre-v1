// A Space agent messages a teammate as itself (owner ruling 4 Nov 2026), on a booted daemon: Mia asks the shared agent Ops "tell Noah ...". It goes into Ops' own chat with Noah, written by Ops with its own name,
// not into Mia's direct chat and not signed as her. Noah's reply lands in that chat and Ops answers it there; Mia's chat gets one short line; Mia cannot read the Ops and Noah chat. Real chats, Gate and tasks;
// only the model is scripted.
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

test("Team: a Space agent messages Noah as itself in its own chat; Noah's reply lands there and the agent answers it there; Mia's chat gets one short line and cannot read the chat", async () => {
  let status = "";
  const model = scriptedModel(async function* (input, run) {
    const said = input.trigger?.body ?? "";
    if (/^tell Noah the Rivera draft/.test(said)) {
      yield* run("tool_search", { query: "people status message person" });
      const who = yield* run("people_status", { q: "Noah" });
      status = JSON.stringify(who.content);
      const handle = ((who.content as { data?: { people?: Array<{ handle: string }> } }).data?.people ?? [])[0]?.handle ?? "noah";
      const r = yield* run("message_person", { to: handle, body: "Mia asked me to tell you the Rivera draft is ready for your review.", idempotencyKey: "self-dm-1" });
      yield { type: "text", text: r.ok ? "Sent to Noah." : `FAILED ${JSON.stringify(r.content).slice(0, 300)}` };
    } else if (input.trigger?.author?.id === "usr_noah" && input.threadId !== "") {
      // Noah's reply in the agent's own chat with him: the agent answers there
      yield { type: "text", text: "Thanks Noah, noted. I will tell Mia." };
    }
  });
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "agentdm-self" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  const list = async (who: string, threadId: string): Promise<Msg[]> => { await d.hooks?.pump?.(); return ((await api(who, "chat.messages.list", { threadId })).data.messages as Msg[] | undefined) ?? []; };
  try {
    await connect(d);
    const agentId = (await api("usr_olivia", "agents.create", { name: "Dex", role: "You help the team.", idempotencyKey: "self-agent" })).data.agent.agentId as string;
    const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "self-ai", name: "AI accounts", scope: "shared" });
    const acct = await api("usr_olivia", "providers.add", { idempotencyKey: "self-acct", providerKey: "anthropic", connection: "api_key", apiKey: `${KEY}A`, name: "Team AI", scope: "shared", folderId: keys.data.folder.id });
    assert.equal((await api("usr_olivia", "agents.update", { agentId, patch: { accountPolicy: "key", accountKey: acct.data.provider.handle }, idempotencyKey: "self-upd" })).status, 200);
    const chat = (await api("usr_mia", "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "self-chat" })).data.thread.threadId as string;
    await api("usr_mia", "chat.post", { threadId: chat, body: "tell Noah the Rivera draft is ready", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "self-p1" });
    const sent = await waitFor(async () => (await list("usr_mia", chat)).find((m) => m.author?.kind === "agent" && /^Sent to Noah\./.test(m.body ?? "")) ?? null, 40_000).catch(async (e) => { throw new Error(`${String(e).slice(0, 80)} CHAT ${JSON.stringify((await list("usr_mia", chat)).map((m) => [m.author?.kind, m.kind, String(m.body).slice(0, 300), JSON.stringify(m.blocks).slice(0, 300)]))} ${hostLog(d).slice(0, 600)}`); });
    assert.ok(sent);
    assert.doesNotMatch(status, /usr_/, "no id in what the model read from people_status");

    // Noah finds it in a chat with the agent, written by the agent, not signed as Mia
    const noahChats = (await api("usr_noah", "chat.recent", {})).data;
    const dmId = (JSON.stringify(noahChats).match(/thr_[0-9a-f]+/g) ?? []).find(() => true) as string | undefined;
    const ids = [...new Set(JSON.stringify(noahChats).match(/thr_[0-9a-f]+/g) ?? [])];
    let found: { id: string; first: Msg } | undefined;
    for (const id of ids) { const m = (await list("usr_noah", id)).find((x) => /Rivera draft is ready/.test(x.body ?? "")); if (m) found = { id, first: m }; }
    assert.ok(found, `Noah reads it in a chat of his own with the agent ${dmId ?? ""}`);
    assert.equal(found!.first.author?.id, agentId, "written by the agent");
    assert.equal(found!.first.blocks?.some((b) => b.type === "on_behalf") ?? false, false, "not signed as Mia");
    // Mia cannot read it
    assert.notEqual((await api("usr_mia", "chat.messages.list", { threadId: found!.id })).status, 200, "the asker cannot read the agent's chat with Noah");

    // Noah replies there: the agent answers there, and Mia's chat gets one line from the agent with none of Noah's words
    assert.equal((await api("usr_noah", "chat.post", { threadId: found!.id, body: "Thanks, I will read it tonight.", idempotencyKey: "self-n1" })).status, 200);
    await waitFor(async () => (await list("usr_noah", found!.id)).find((m) => m.author?.id === agentId && /Thanks Noah, noted/.test(m.body ?? "")) ?? null, 40_000, () => hostLog(d));
    const lines = (await list("usr_mia", chat)).filter((m) => m.kind === "quiet" && /^Connected with Noah\./.test(m.body ?? ""));
    assert.equal(lines.length, 1, "one line");
    assert.equal(lines[0]?.author?.id, agentId, "the report is the agent's own line");
    assert.ok(!/Thanks, I will read it tonight|Noah replied/.test(JSON.stringify(await list("usr_mia", chat))), "none of Noah's words reach Mia's chat");
  } finally { await stop(d); }
});
