// runnable-account.ts: an account pays for a turn only if its engine can run on this computer. The pick stays when it can run; otherwise another usable account of the person answers (the one connected
// most recently), the chat says so once, a turn pinned to a server is left to that server, a swapped command counts as installed, and with nothing runnable the pick stays so the start names the program.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AccountQuery, ResolvedAccount } from "../../../agent/src/turn-engine/index.ts";
import { checkedOpen, createRunnableAccount, missingProgram } from "../runnable-account.ts";
import type { NodeCliProbe } from "../cli-programs.ts";
import { EngineInstallError } from "../engine-install.ts";

const acct = (ref: string, driver: string, provider: string): ResolvedAccount => ({ ref, driver, provider, kind: driver === "anthropic" || driver === "openrouter" ? "api_key" : "subscription", payer: "dana", reason: "starter" });
const CODEX = acct("#Codex", "codex", "openai"), CLAUDE = acct("#Claude", "claude_code", "anthropic"), GROK = acct("#Grok", "grok", "xai"), KEY = acct("#Key", "anthropic", "anthropic");
const Q: AccountQuery = { threadId: "T1", agentId: "A1", askerId: "dana" };

function installed(...programs: string[]): NodeCliProbe {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-runnable-"));
  fs.mkdirSync(path.join(dir, ".local", "bin"), { recursive: true });
  for (const p of programs) fs.writeFileSync(path.join(dir, ".local", "bin", p), "#!/bin/sh\n", { mode: 0o755 });
  return { platform: "darwin", env: { PATH: "/usr/bin:/bin", HOME: dir } };
}

function chain(o: { order: ResolvedAccount[]; connected?: string[]; probe: NodeCliProbe; placement?: string; command?: Record<string, string[]> }) {
  const posted: string[] = [];
  const resolved: AccountQuery[] = [];
  const fn = createRunnableAccount({
    call: async (cap) => (cap === "engine.accounts.list" ? { accounts: (o.connected ?? o.order.map((a) => a.ref)).map((ref) => ({ ref })) } : { placement: "host", reason: o.placement ?? "default" }),
    resolve: async (q) => { resolved.push(q); return o.order.find((a) => !(q.unavailable ?? []).includes(a.ref)) ?? null; },
    probe: o.probe, ...(o.command ? { command: o.command } : {}),
    postAs: async (_a, post) => { posted.push(((post as { blocks: Array<{ data: { text: string } }> }).blocks[0]?.data.text) ?? ""); return undefined as never; },
  });
  return { fn, posted, resolved };
}

test("a pick that can run is returned untouched, with no second resolve and no line in the chat", async () => {
  const c = chain({ order: [CLAUDE, CODEX], probe: installed("claude") });
  assert.equal((await c.fn(Q))?.ref, "#Claude");
  assert.equal(c.resolved.length, 1);
  assert.deepEqual(c.posted, []);
  const api = chain({ order: [KEY], probe: installed() });
  assert.equal((await api.fn(Q))?.ref, "#Key", "an API account needs no program");
});

test("a pick whose program is missing gives way to the account connected most recently that can run", async () => {
  // the policy order is Codex, Claude, Grok (all installed but Codex), and Grok was connected last
  const c = chain({ order: [CODEX, CLAUDE, GROK], connected: ["#Codex", "#Claude", "#Grok"], probe: installed("claude", "grok") });
  assert.equal((await c.fn(Q))?.ref, "#Grok");
  assert.deepEqual(c.posted, ["Codex is not installed here, so Grok answered."]);
  const older = chain({ order: [CODEX, CLAUDE, GROK], connected: ["#Codex", "#Grok", "#Claude"], probe: installed("claude", "grok") });
  assert.equal((await older.fn(Q))?.ref, "#Claude");
  assert.deepEqual(older.posted, ["Codex is not installed here, so Claude answered."]);
});

test("an API key of the person is a way out when the program is missing, and the line names the provider", async () => {
  const c = chain({ order: [CODEX, KEY], probe: installed() });
  assert.equal((await c.fn(Q))?.ref, "#Key");
  assert.deepEqual(c.posted, ["Codex is not installed here, so Anthropic answered."]);
});

test("the change is said once per chat and pair of accounts", async () => {
  const c = chain({ order: [CODEX, CLAUDE], probe: installed("claude") });
  await c.fn(Q); await c.fn(Q); await c.fn({ ...Q, threadId: "T2" });
  assert.equal(c.posted.length, 2);
});

test("with no account that can run the pick stays, so the start fails naming the program", async () => {
  const c = chain({ order: [CODEX, CLAUDE], probe: installed() });
  assert.equal((await c.fn(Q))?.ref, "#Codex");
  assert.deepEqual(c.posted, []);
});

test("a turn pinned to a server is not checked on this computer; a swapped command counts as installed", async () => {
  const pinned = chain({ order: [CODEX, CLAUDE], probe: installed(), placement: "chosen_server" });
  assert.equal((await pinned.fn(Q))?.ref, "#Codex");
  const off = chain({ order: [CODEX, CLAUDE], probe: installed(), placement: "server_off" });
  assert.equal((await off.fn(Q))?.ref, "#Codex");
  const swapped = chain({ order: [CODEX], probe: installed(), command: { codex: ["node", "fake.mjs"] } });
  assert.equal((await swapped.fn(Q))?.ref, "#Codex");
  assert.equal(missingProgram("codex", { probe: installed() }), "codex");
  assert.equal(missingProgram("codex", { probe: installed("codex") }), null);
});

test("a turn that has no account yet is passed on; checkedOpen refuses a missing program before the session opens", async () => {
  const none = chain({ order: [], probe: installed() });
  assert.equal(await none.fn(Q), null);
  let opened = 0;
  const open = checkedOpen(async () => { opened++; return undefined as never; }, { probe: installed("claude") });
  await assert.rejects(open({ threadId: "T1", turnId: "t", traceId: "x", asker: "dana", agent: { id: "A1", mode: "lead", model: "m" }, account: CODEX } as never), (e: unknown) => (e as { code?: string }).code === "engine.cli_missing");
  assert.equal(opened, 0);
  await open({ threadId: "T1", turnId: "t", traceId: "x", asker: "dana", agent: { id: "A1", mode: "lead", model: "m" }, account: CLAUDE } as never);
  assert.equal(opened, 1);
});

/** An installer whose install of each program is held until the test lets it go; `fail` makes it fail with that reason. */
function setupOf(o: { supported?: string[]; failedRecently?: string[]; fail?: "offline" | "checksum" } = {}) {
  const asked: string[] = [];
  let release: () => void = () => undefined;
  const engines = {
    supported: (p: string) => (o.supported ?? ["claude", "codex", "grok"]).includes(p),
    failedRecently: (p: string) => (o.failedRecently ?? []).includes(p),
    ensure: (p: string) => { asked.push(p); return new Promise<string>((ok, no) => { release = () => (o.fail ? no(new EngineInstallError(o.fail, "no")) : ok(`/e/${p}`)); }); },
    state: () => ({ phase: "installing" as const, done: 40, total: 100 }),
  };
  return { engines, asked, release: () => release() };
}

test("a pick whose program is missing but can be installed here stays: the install starts at once and no other account answers", async () => {
  const s = setupOf();
  const posted: unknown[] = [];
  const fn = createRunnableAccount({ call: async (cap) => (cap === "engine.accounts.list" ? { accounts: [] } : { placement: "host", reason: "default" }), resolve: async (q) => [CODEX, CLAUDE].find((a) => !(q.unavailable ?? []).includes(a.ref)) ?? null, probe: installed("claude"), engines: s.engines, postAs: async (_a, post) => { posted.push(post); return undefined as never; } });
  assert.equal((await fn(Q))?.ref, "#Codex", "the account the person chose");
  assert.deepEqual(s.asked, ["codex"], "the download starts while the turn is set up");
  assert.deepEqual(posted, [], "nothing to say: Codex answers");
});

test("when the last install failed a short while ago, or there is no build for this computer, another account answers and the line says which", async () => {
  const posted: string[] = [];
  const make = (engines: ReturnType<typeof setupOf>["engines"]) => createRunnableAccount({
    call: async (cap) => (cap === "engine.accounts.list" ? { accounts: [] } : { placement: "host", reason: "default" }), resolve: async (q) => [CODEX, CLAUDE].find((a) => !(q.unavailable ?? []).includes(a.ref)) ?? null,
    probe: installed("claude"), engines, postAs: async (_a, post) => { posted.push(((post as { blocks: Array<{ data: { text: string } }> }).blocks[0]?.data.text) ?? ""); return undefined as never; },
  });
  const failed = setupOf({ failedRecently: ["codex"] });
  assert.equal((await make(failed.engines)(Q))?.ref, "#Claude");
  assert.deepEqual(posted, ["Codex could not be set up here, so Claude answered."]);
  assert.deepEqual(failed.asked, [], "no second download for this turn");
  const none = setupOf({ supported: [] });
  assert.equal((await make(none.engines)({ ...Q, threadId: "T9" }))?.ref, "#Claude");
  assert.equal(posted[1], "Codex is not installed here, so Claude answered.");
});

test("checkedOpen: the turn waits for the install with a live line (Setting up Codex, how far it has got), then opens on the account it was given", async () => {
  const s = setupOf();
  const live: Array<Record<string, unknown>> = [];
  let opened: unknown = null;
  const open = checkedOpen(async (spec) => { opened = spec.account?.ref; return undefined as never; }, { probe: installed("claude"), engines: s.engines, live: (e) => live.push(e as never), beatMs: 5 });
  const spec = { threadId: "T1", turnId: "t1", traceId: "x", asker: "dana", agent: { id: "A1", mode: "lead", model: "m" }, account: CODEX } as never;
  const p = open(spec);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(opened, null, "nothing opens before the program is there");
  s.release();
  await p;
  assert.equal(opened, "#Codex", "the intended account, not a fallback");
  assert.deepEqual(live[0], { kind: "step", phase: "call", threadId: "T1", turnId: "t1", agentId: "A1", id: "setup_codex", name: "engine_setup" });
  assert.deepEqual(live[1], { kind: "step", phase: "input", threadId: "T1", turnId: "t1", agentId: "A1", id: "setup_codex", detail: "Codex, 40%" });
  assert.ok(live.filter((e) => e["phase"] === "input").length >= 2, "the line keeps saying how far it has got, so the screen keeps the turn");
  assert.deepEqual(live.at(-1), { kind: "step", phase: "result", threadId: "T1", turnId: "t1", agentId: "A1", id: "setup_codex", ok: true });
});

test("checkedOpen: an install that fails ends the turn with engine.cli_missing naming the program and why, and nothing opens; with no build here it says unsupported", async () => {
  const s = setupOf({ fail: "offline" });
  let opened = 0;
  const live: Array<Record<string, unknown>> = [];
  const open = checkedOpen(async () => { opened++; return undefined as never; }, { probe: installed(), engines: s.engines, live: (e) => live.push(e as never) });
  const spec = { threadId: "T1", turnId: "t1", traceId: "x", asker: "dana", agent: { id: "A1", mode: "lead", model: "m" }, account: GROK } as never;
  const p = open(spec);
  s.release();
  await assert.rejects(p, (e: unknown) => (e as { code?: string }).code === "engine.cli_missing" && (e as Error).message === "grok is not installed on this computer (offline).");
  assert.equal(opened, 0);
  assert.equal(live.at(-1)?.["ok"], false);
  const none = setupOf({ supported: [] });
  await assert.rejects(checkedOpen(async () => undefined as never, { probe: installed(), engines: none.engines })(spec), (e: unknown) => (e as Error).message === "grok is not installed on this computer (unsupported).");
  assert.deepEqual(none.asked, []);
});
