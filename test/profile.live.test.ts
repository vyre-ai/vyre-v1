// The person profile on a booted daemon (owner ruling 3 Nov): Olivia's private profile is in the context of her own chat with any of her agents and never in a channel or a group chat with
// Noah; her public profile is in both; a fact one agent learned is in another agent's context; moving a fact to public changes what the channel hears. Nothing is faked inside the daemon:
// chat, channels, agents, engine and memory are live. The model is a stand-in that answers with the profile section of the context it was handed.
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CORE_SPACE, bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake
const PRIVATE = "Olivia is going through IVF and leaves early on Thursdays.";
const LEARNED = "Olivia's daughter has swim practice on Mondays.";
const PUBLIC = "Olivia wants client emails short, with no exclamation marks.";

/** The model stand-in: it answers with the person section of its context, so the test reads exactly what the agent was given. */
const standIn = async () => ({
  warm: true,
  async *send(input: { context?: { sections: Array<{ id: string; text: string }> } }) {
    const person = input.context?.sections.find((s) => s.id === "person")?.text ?? "(none)";
    yield { type: "text", text: `[person] ${person}` };
    yield { type: "done" };
  },
  sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
});

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-profile-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

async function boot(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "profile-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    vault: { secret: async () => KEY, signRs256: async () => "" },
    session: (headers: Record<string, string | undefined>) => {
      const id = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      return ["usr_olivia", "usr_noah"].includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "profile-live" } : null;
    },
    engineOpenSession: standIn,
  });
}

async function call(d: Daemon, cap: string, input: unknown, who = "usr_olivia"): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
async function ok(d: Daemon, cap: string, input: unknown, who?: string): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, input, who);
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
}

function hostLog(d: Daemon): string {
  d.sink.flush();
  const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, msg, attrs FROM logs WHERE level >= 40 ORDER BY id DESC LIMIT 12").all() as Array<{ level: number; msg: string; attrs?: string }>;
  return JSON.stringify(rows.map((r) => `${r.level} ${r.msg} ${String(r.attrs ?? "").slice(0, 300)}`));
}

/** Post as `who` mentioning the agent, and wait for the agent's next reply in the thread. */
async function ask(d: Daemon, threadId: string, agentId: string, body: string, key: string, who = "usr_olivia"): Promise<string> {
  const agentReplies = async (): Promise<string[]> => ((await ok(d, "chat.messages.list", { threadId }, who)).messages as Array<{ author?: { kind?: string }; body?: string }>).filter((m) => m.author?.kind === "agent" && (m.body ?? "") !== "").map((m) => m.body as string);
  const before = (await agentReplies()).length;
  await ok(d, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: key }, who);
  const end = Date.now() + 40_000;
  for (;;) {
    await d.hooks?.pump?.();
    const all = await agentReplies();
    if (all.length > before) return all[all.length - 1]!;
    if (Date.now() > end) throw new Error(`no reply to ${key}; host log ${hostLog(d)}`);
    await new Promise<void>((r) => setTimeout(r, 200));
  }
}

test("profile live: private only in Olivia's own chats, public everywhere, shared across her agents, and a move changes what the channel hears", async () => {
  // memory learns after every turn (l-memlearn) and reads the account's model list once, which asks the vendor with the key (providers.test): answer that here, so the scripted key is not
  // refused by the real vendor and the shared account marked failing before Noah's turn
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => (String(url) === "https://api.anthropic.com/v1/models"
    ? Promise.resolve(new Response(JSON.stringify({ data: [{ id: "claude-haiku-4-5" }] }), { status: 200, headers: { "content-type": "application/json" } }))
    : realFetch(url, init))) as typeof fetch;
  const d = await boot(seededDir());
  try {
    // a key the whole Space may use, so Olivia's and Noah's turns are both paid for
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer usr_olivia" }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204);
    const folder = await ok(d, "vault.folders.create", { idempotencyKey: "pl-folder", name: "Team keys", scope: "shared" });
    const shared = await ok(d, "providers.add", { idempotencyKey: "pl-shared", providerKey: "anthropic", connection: "api_key", apiKey: KEY, scope: "shared", folderId: folder.folder.id });
    const agent = async (name: string): Promise<string> => {
      const id = (await ok(d, "agents.create", { name, role: "You help.", idempotencyKey: `pl-agent-${name}` })).agent.agentId as string;
      await ok(d, "agents.update", { agentId: id, patch: { accountPolicy: "key", accountKey: shared.provider.handle }, idempotencyKey: `pl-pin-${name}` });
      return id;
    };
    const intake = await agent("Intake");
    const billing = await agent("Billing");

    // Olivia's profile: a public fact and a private one by hand, and one Intake learned in her chat with it
    await ok(d, "memory.profile.add", { text: PUBLIC, to: "public" });
    const priv = (await ok(d, "memory.profile.add", { text: PRIVATE, to: "private" })).fact.factId as string;
    const intakeChat = (await ok(d, "chat.start", { kind: "chat", agentIds: [intake], idempotencyKey: "pl-intake-chat" })).thread.threadId as string;
    const learned = await ok(d, "memory.remember", { text: LEARNED, kind: "profile", threadId: intakeChat, agentId: intake });
    assert.equal(learned.fact.layer, "person");

    // her own chat with Billing: both parts, and what Intake learned
    const billingChat = (await ok(d, "chat.start", { kind: "chat", agentIds: [billing], idempotencyKey: "pl-billing-chat" })).thread.threadId as string;
    const mine = await ask(d, billingChat, billing, "Draft my week, please.", "pl-mine");
    assert.ok(mine.includes(PRIVATE), mine);
    assert.ok(mine.includes(LEARNED), `learned by Intake, used by Billing: ${mine}`);
    assert.ok(mine.includes(PUBLIC), mine);
    assert.match(mine, /Only they and their own agents are in this chat/);

    // a public channel with Olivia and Noah: Olivia asks, then Noah asks
    const ch = (await ok(d, "channels.create", { name: "intake-team", visibility: "public", memberIds: ["usr_noah"], agentIds: [billing], idempotencyKey: "pl-channel" })).channel as { mainThreadId: string };
    const inChannel = await ask(d, ch.mainThreadId, billing, "Draft the client update for the team.", "pl-ch1");
    assert.ok(inChannel.includes(PUBLIC), inChannel);
    assert.ok(!inChannel.includes(PRIVATE) && !inChannel.includes(LEARNED), `a private fact in a channel turn: ${inChannel}`);
    assert.match(inChannel, /public profile only/);
    const noahAsks = await ask(d, ch.mainThreadId, billing, "What should I know before I email Olivia's client?", "pl-ch2", "usr_noah");
    assert.ok(noahAsks.includes(PUBLIC), `Olivia's public profile, for Noah's turn: ${noahAsks}`);
    assert.ok(!noahAsks.includes(PRIVATE) && !noahAsks.includes(LEARNED), noahAsks);

    // a group chat with Noah (the agent answering there): public only
    const group = (await ok(d, "chat.start", { kind: "chat", agentIds: [billing], personId: "usr_noah", idempotencyKey: "pl-group" })).thread.threadId as string;
    const inGroup = await ask(d, group, billing, "Plan the handover with Noah.", "pl-group-1");
    assert.ok(inGroup.includes(PUBLIC) && !inGroup.includes(PRIVATE) && !inGroup.includes(LEARNED), inGroup);

    // Noah (a member, not an admin) reading Olivia's profile gets her public part only; he cannot move her facts or erase them
    const seen = await ok(d, "memory.profile.get", { personId: "usr_olivia" }, "usr_noah");
    assert.deepEqual((seen.public as Array<{ text: string }>).map((f) => f.text), [PUBLIC]);
    assert.deepEqual(seen.private, []);
    assert.notEqual((await call(d, "memory.profile.move", { factId: priv, to: "public" }, "usr_noah")).status, 200);
    assert.notEqual((await call(d, "memory.erase", { factIds: [priv] }, "usr_noah")).status, 200);

    // Olivia moves the learned fact to public: the channel hears it now; the private one still never
    await ok(d, "memory.profile.move", { factId: learned.fact.factId, to: "public" });
    const after = await ask(d, ch.mainThreadId, billing, "Anything new for the team plan?", "pl-ch3");
    assert.ok(after.includes(LEARNED), after);
    assert.ok(!after.includes(PRIVATE), after);
    // and back to private
    await ok(d, "memory.profile.move", { factId: learned.fact.factId, to: "private" });
    const back = await ask(d, ch.mainThreadId, billing, "And now?", "pl-ch4");
    assert.ok(!back.includes(LEARNED), back);

    // Erase completely, by Olivia: gone from her own chat too
    await ok(d, "memory.erase", { factIds: [priv] });
    const gone = await ask(d, billingChat, billing, "Draft my week again.", "pl-mine2");
    assert.ok(!gone.includes(PRIVATE), gone);
  } finally {
    await d.stop();
    globalThis.fetch = realFetch;
  }
});
