// What holds an agent's message to a teammate, two members on a booted daemon (lane l-agentdm): outside the teammate's own working hours it waits and the person sees "Scheduled for Adam"; the fourth
// message in an hour from Mia's agents to Noah waits; Noah mutes Mia's agents for today and the next one waits until tomorrow while Mia is told. Real chats and Gate; only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY, boot, connect, hostLog, scriptedModel, seededDir, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const WHO = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah"];
const IDS: Record<string, string> = { Noah: "usr_noah", Adam: "usr_adam", Olivia: "usr_olivia" };
type Msg = { author?: { kind?: string; id?: string }; kind?: string; body?: string };

const as = (d: Daemon) => async (who: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const b = (await r.json()) as { data?: unknown };
  return { status: r.status, data: b.data ?? b };
};

test("Team: after hours, the hourly limit and a mute hold Mia's agent messages; Mia sees each as Scheduled, with the reason", async () => {
  const outcomes: Array<{ to: string; state?: string; when?: string }> = [];
  let n = 0;
  const model = scriptedModel(async function* (input, run) {
    const m = /^tell (Noah|Adam|Olivia) (.+)$/.exec(input.trigger?.body ?? "");
    if (!m) return;
    const r = yield* run("message_person", { to: IDS[m[1]!], body: m[2]!, idempotencyKey: `holds-${++n}` });
    const out = (r.ok ? (r.content as { data?: unknown }).data ?? {} : {}) as { state?: string; when?: string };
    outcomes.push({ to: m[1]!, ...(out.state ? { state: out.state } : {}), ...(out.when ? { when: out.when } : {}) });
    yield { type: "text", text: `Done ${n}: ${out.state ?? "failed"}` };
  });
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "agentdm-holds" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  const list = async (who: string, threadId: string): Promise<Msg[]> => { await d.hooks?.pump?.(); return ((await api(who, "chat.messages.list", { threadId })).data.messages as Msg[] | undefined) ?? []; };
  try {
    await connect(d);
    const agentId = (await api("usr_olivia", "agents.create", { name: "Ops", role: "You help the team.", ownerId: "usr_mia", idempotencyKey: "h-agent" })).data.agent.agentId as string;
    const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "h-ai", name: "AI accounts", scope: "shared" });
    const acct = await api("usr_olivia", "providers.add", { idempotencyKey: "h-acct", providerKey: "anthropic", connection: "api_key", apiKey: `${KEY}A`, name: "Team AI", scope: "shared", folderId: keys.data.folder.id });
    assert.equal((await api("usr_olivia", "agents.update", { agentId, patch: { accountPolicy: "key", accountKey: acct.data.provider.handle }, idempotencyKey: "h-upd" })).status, 200);
    // this test is about an Assistant writing for its person: Ops is Mia's and stands in as her Assistant (a Space agent writes as itself, test/agent-dm.self.live.test.ts)
    { const { DatabaseSync } = await import("node:sqlite"); const db = new DatabaseSync(d.paths.modules); db.prepare("UPDATE agents_agent SET kind = 'assistant' WHERE id = ?").run(agentId); db.close(); }
    const chat = (await api("usr_mia", "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "h-chat" })).data.thread.threadId as string;
    let k = 0;
    const tell = async (body: string): Promise<void> => {
      const before = outcomes.length;
      assert.equal((await api("usr_mia", "chat.post", { threadId: chat, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `h-post-${++k}` })).status, 200);
      await waitFor(async () => { await d.hooks?.pump?.(); return outcomes.length > before ? true : null; }, 30_000, () => hostLog(d));
    };
    const quiet = async (re: RegExp) => waitFor(async () => (await list("usr_mia", chat)).find((m) => m.kind === "quiet" && re.test(m.body ?? "")) ?? null, 15_000, () => hostLog(d));
    const dmWith = async (who: string): Promise<string> => (await api("usr_mia", "chat.start", { kind: "chat", agentIds: [], personId: who, idempotencyKey: `h-open-${who}` })).data.thread.threadId as string;

    // after hours: Adam works only in a two-hour window that is not now (UTC), so it waits for his next start
    const h = new Date().getUTCHours();
    const pad = (x: number): string => String(x % 24).padStart(2, "0");
    assert.equal((await api("usr_adam", "settings.set", { key: "profile.timezone", value: "UTC" })).status, 200);
    assert.equal((await api("usr_adam", "settings.set", { key: "profile.working_hours", value: { days: [0, 1, 2, 3, 4, 5, 6], from: `${pad(h + 3)}:00`, to: `${pad(h + 5)}:00` } })).status, 200);
    await tell("tell Adam the Rivera file moved to Friday");
    assert.equal(outcomes.at(-1)?.state, "scheduled", JSON.stringify(outcomes));
    assert.match(outcomes.at(-1)?.when ?? "", /^Scheduled for Adam .*: .*outside Adam's working hours/);
    await quiet(/^Scheduled for Adam .*: .*outside Adam's working hours/);
    assert.equal((await list("usr_adam", await dmWith("usr_adam"))).length, 0, "nothing reached Adam yet");

    // away (lane l-team1's devices.presence, from notifications.away): Olivia is away for an hour, so it waits until she is back
    const back = Date.now() + 3_600_000;
    assert.equal((await api("usr_olivia", "notifications.away.set", { until: back, delegate: { kind: "none" } })).status, 200);
    await tell("tell Olivia the Rivera invoice went out");
    assert.equal(outcomes.at(-1)?.state, "scheduled", JSON.stringify(outcomes));
    await quiet(/^Scheduled for Olivia .*\(Olivia is away\)/);
    assert.equal((await list("usr_olivia", await dmWith("usr_olivia"))).length, 0, "nothing reached Olivia while she is away");

    // 3 an hour to Noah: the fourth waits for the hour, and Mia sees why
    for (let i = 1; i <= 3; i++) { await tell(`tell Noah update ${i} is in`); assert.equal(outcomes.at(-1)?.state, "sent", JSON.stringify(outcomes)); }
    await tell("tell Noah update 4 is in");
    assert.equal(outcomes.at(-1)?.state, "scheduled");
    await quiet(/^Scheduled for Noah .*3 agent messages went to Noah this hour/);
    const dm = await dmWith("usr_noah");
    assert.deepEqual((await list("usr_noah", dm)).map((m) => m.body), ["update 1 is in", "update 2 is in", "update 3 is in"]);

    // Noah mutes Mia's agents for today: Mia is told, and what comes next waits until tomorrow
    const muted = await api("usr_noah", "chat.agent_dm.mute", { personId: "usr_mia" });
    assert.equal(muted.status, 200, JSON.stringify(muted.data));
    assert.ok(muted.data.until > Date.now());
    await quiet(/muted agent messages from you for today/);
    assert.notEqual((await api("usr_mia", "chat.agent_dm.mute", { personId: "usr_mia" })).status, 200, "nobody mutes themselves");
    await tell("tell Noah update 5 is in, it is urgent");
    assert.equal(outcomes.at(-1)?.state, "scheduled");
    await quiet(/^Scheduled for Noah .*Noah muted agent messages from you for today/);
    assert.equal((await list("usr_noah", dm)).length, 3, "still three");
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 2000) : e); throw e; } finally { await stop(d); }
});
