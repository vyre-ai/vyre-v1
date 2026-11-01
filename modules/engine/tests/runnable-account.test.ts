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
