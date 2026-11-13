// @heavy docker
// The owner asks an agent that runs on a Claude Code sign-in (a CLI engine reaching Vyre through MCP) to move a goal's deadline: it does, logged with the asking message. The same agent in a goal's wake-up
// and after a poke is refused. The CLI is the fake CLI of host/tests/fixtures/fake-cli-driver in the platform sandbox; the MCP server, the session the host mints, the bridge, the engine queue and goals are the real ones.
// The core proof for agents on a booted daemon (P-L2_LIVE, golden flow 7's engine half): a person's message to an agent over HTTP gets a streamed reply in the real chat thread. Nothing is faked
// inside the daemon: chat, agents, engine and the bridge are live; the Vault module still answers from its stub (its example provider is a Claude Code subscription), the secret comes from the
// daemon's Vault port, and the CLI is the fake CLI of host/tests/fixtures/fake-cli-driver run in the platform's default sandbox (bubblewrap with the network wall on the Linux runner).
// Runs only with VYRE_HEAVY_DOCKER=1 (the l2-heavy job).
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-goals-cli-live-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the CLI runs in the real sandbox)";
const FAKE_CLI = fileURLToPath(new URL("./fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake

async function boot(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "chat-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    // the Vault value behind the account the Vault module's example names; the access check is vault.use through the pipeline
    vault: { secret: async () => KEY, signRs256: async () => "" },
    // the real CLI is swapped for the fake one, which the sandbox is given read-only; the sandbox is the platform's default (bwrap with the network wall on Linux)
    engineCli: { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] },
  });
}

async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

/** What the host logged at warn level or about the engine, so a reply that never comes says why. */
function hostLog(d: Daemon): string {
  d.sink.flush();
  const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, cap, msg, attrs FROM logs WHERE level >= 30 OR msg LIKE '%consumer%' OR msg LIKE '%bridge%' OR msg LIKE '%engine%' ORDER BY id DESC LIMIT 30").all() as Array<{ level: number; place: string | null; cap: string | null; msg: string; attrs: string | null }>;
  return JSON.stringify(rows.map((r) => `${r.level} ${r.place ?? ""} ${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 300)}`));
}

async function waitFor<T>(f: () => Promise<T | null>, ms = 40_000, why?: () => string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v !== null) return v;
    if (Date.now() > end) throw new Error(`waitFor: it never happened${why ? `; host log ${why()}` : ""}`);
    await new Promise<void>((r) => setTimeout(r, 200));
  }
}


const DAY = 86_400_000;
test("goals live (CLI engine over MCP): a typed ask in another chat moves the deadline and is logged; a goal wake and a poke are refused", { skip, timeout: 240_000 }, async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204);
    const ok = async (cap: string, input: Record<string, unknown>): Promise<any> => { const r = await call(d, cap, input); assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`); return r.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any
    const folder = await ok("vault.folders.create", { idempotencyKey: "g-folder", name: "Accounts", scope: "mine" });
    const flow = await ok("providers.subscription_start", { idempotencyKey: "g-flow", providerKey: "claude-code" });
    await ok("vault.item.put", { idempotencyKey: "g-item", folderId: folder.folder.id, name: "Olivia_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] });
    const provider = await ok("providers.subscription_complete", { flowId: flow.flowId });
    await ok("providers.set_space_use", { idempotencyKey: "g-use", providerId: provider.provider.id, allow: true });
    const dex = (await ok("agents.create", { name: "Dex", role: "You help.", idempotencyKey: "g-dex" })).agent.agentId as string;
    const desk = (await ok("agents.create", { name: "Lab Desk", role: "You lead goals.", idempotencyKey: "g-desk" })).agent.agentId as string;
    await ok("engine.pool.status", {});
    const messagesOf = async (threadId: string): Promise<string[]> => { await d.hooks?.pump?.(); return ((await ok("chat.messages.list", { threadId })).messages as Array<{ author?: { kind?: string }; body?: string }>).filter((m) => m.author?.kind === "agent").map((m) => m.body ?? ""); };
    /** What each turn of a chat said and did, from the engine's own record of the turn (the lead's text is not posted in the goal chat). */
    const turnsSaid = async (threadId: string): Promise<string[]> => {
      const list = ((await call(d, "engine.turns.list", { threadId })).data.turns ?? []) as Array<{ turnId: string }>;
      const out: string[] = [];
      for (const t of list) out.push(JSON.stringify((await call(d, "engine.turn.get", { turnId: t.turnId })).data.what?.steps ?? []));
      return out;
    };
    const dump = async (threadId: string): Promise<string> => JSON.stringify({ steps: (await turnsSaid(threadId)).map((x) => x.slice(0, 600)), messages: ((await call(d, "chat.messages.list", { threadId })).data.messages ?? []).map((m: { author?: { kind?: string }; body?: string }) => `${m.author?.kind}: ${String(m.body).slice(0, 120)}`), turns: ((await call(d, "engine.turns.list", { threadId })).data.turns ?? []).map((t: { state: string; error?: unknown }) => [t.state, t.error]) });
    const answer = async (re: RegExp, threadId: string, why: string) => { try { return await waitFor(async () => (await messagesOf(threadId)).find((b) => re.test(b)) ?? null, 90_000); } catch { throw new Error(`${why}: ${await dump(threadId)}`); } };

    const first = Date.now() + 4 * DAY;
    const made = await ok("goals.create", {
      idempotencyKey: "g-goal", title: "3 registrations for Lab 8", finish: { kind: "number", line: "Lab 8 registrations reach 3", target: 3, unit: "registrations", source: { kind: "records", type: "contact", label: "Lab 8 registrations" } },
      deadline: first, leadAgentId: desk, rhythm: { every: "hours", hours: 6 }, quiet: null, zone: "UTC", budget: { turns: 60 },
    });
    const goalId = made.goal.id as string;
    const deadlineNow = async (): Promise<number> => (await ok("goals.get", { goalId })).goal.deadline as number;

    // the goal's own wake-up, on the CLI: the lead tries the owner's control and is refused
    const wakeFiles = (): string[] => { const found: string[] = []; const walk = (p: string): void => { let es: fs.Dirent[] = []; try { es = fs.readdirSync(p, { withFileTypes: true }); } catch { return; } for (const e of es) { const q = path.join(p, e.name); if (e.isDirectory()) walk(q); else if (e.name === "fake-wake-result.txt") found.push(fs.readFileSync(q, "utf8")); } }; walk(dir); return found; };
    const woke = await waitFor(async () => { await d.hooks?.pump?.(); return wakeFiles().join("\n") || null; }, 60_000, () => { const l: string[] = []; const w = (p: string): void => { let es: fs.Dirent[] = []; try { es = fs.readdirSync(p, { withFileTypes: true }); } catch { return; } for (const e of es) { const q = path.join(p, e.name); if (e.isDirectory()) w(q); else if (/fake|session/i.test(q)) l.push(`${q.replace(dir, "")}: ${fs.readFileSync(q, "utf8").slice(0, 400)}`); } }; w(dir); return JSON.stringify(l.slice(0, 20)); });
    assert.match(woke, /goals_extend refused/, woke);
    assert.doesNotMatch(woke, /goals_extend answered/, woke);
    assert.equal(await deadlineNow(), first, "a turn nobody asked for changed nothing");

    // the owner asks Dex in a chat of their own, typed, in their own words
    const chat = (await ok("chat.start", { kind: "chat", agentIds: [dex], idempotencyKey: "g-chat" })).thread.threadId as string;
    const later = first + 5 * DAY;
    const posted = await ok("chat.post", { threadId: chat, body: `toolfind goals_extend ${JSON.stringify({ goalId, deadline: later })}`, mentions: [{ kind: "agent", id: dex }], idempotencyKey: "g-ask" });
    const done = await answer(/goals_extend (refused|answered)/, chat, "the typed ask");
    assert.match(done, /goals_extend answered/, done);
    const got = await ok("goals.get", { goalId });
    assert.equal(got.goal.deadline, later);
    const row = (got.activity as Array<{ kind: string; by?: string; ref?: string; tpl?: string }>).find((a) => a.kind === "extended")!;
    assert.match(row.by ?? "", new RegExp(`^${dex}>usr_`));
    assert.equal(row.ref, posted.message.messageId);
    assert.match(row.tpl ?? "", /moved the deadline to \{at:\d+\}, asked by \{who:usr_/);

    // a poke is a line the server posts, never the owner's typed ask
    await ok("threads.poke", { threadId: chat, agentId: dex, note: `toolfind goals_extend ${JSON.stringify({ goalId, deadline: later + DAY })}` });
    try { await waitFor(async () => ((await messagesOf(chat)).filter((b) => /goals_extend (refused|answered)/.test(b)).length >= 2 ? true : null), 90_000); } catch { throw new Error(`the poke: ${await dump(chat)}`); }
    const replies = (await messagesOf(chat)).filter((b) => /goals_extend (refused|answered)/.test(b));
    assert.match(replies[1]!, /goals_extend refused/, String(replies[1]));
    assert.equal(await deadlineNow(), later, "the poke changed nothing");
  } finally { await d.stop(); }
});
