// A chat whose account is a Codex sign-in on a computer with no `codex`: the real turn engine, the real account chain (runnable-account.ts over a scripted engine.account.resolve), the real session
// opener with the Vault fill, and the fake CLI (host/tests/fixtures/fake-cli-driver) standing in for Claude Code installed in ~/.local/bin. The turn is answered by Claude and the chat says so in one
// line; with nothing installed the turn fails with engine.cli_missing naming the program, before any engine starts, and no key is read from the Vault for an engine that cannot run.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalLauncher, LaunchError } from "../../../agent/src/drivers/cli/index.ts";
import { createTurnEngine } from "../../../agent/src/turn-engine/index.ts";
import type { AccountQuery, EngineAgent, ResolvedAccount, SessionSpec } from "../../../agent/src/turn-engine/index.ts";
import type { Lookup, ValueSource } from "../../../agent/src/vault-use/index.ts";
import { buildNodeOpener, refuseMissingProgram } from "../session.ts";
import { checkedOpen, createRunnableAccount } from "../runnable-account.ts";
import type { NodeCliProbe } from "../cli-programs.ts";

const FAKE_CLI = fileURLToPath(new URL("../../../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const CLAUDE_KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake
const TRACE = "a".repeat(32);
const AGENT: EngineAgent = { id: "intake", mode: "lead", model: "gpt-5" };

const CODEX: ResolvedAccount = { ref: "#Dana_Codex", driver: "codex", provider: "openai", kind: "subscription", payer: "dana", reason: "starter" };
const CLAUDE: ResolvedAccount = { ref: "#Dana_Claude", driver: "claude_code", provider: "anthropic", kind: "subscription", payer: "dana", reason: "starter" };

/** A home like the owner's Mac: Claude Code in ~/.local/bin, no Codex anywhere. */
function home(programs: string[]): { probe: NodeCliProbe; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-home-"));
  const bin = path.join(dir, ".local", "bin");
  fs.mkdirSync(bin, { recursive: true });
  for (const p of programs) fs.writeFileSync(path.join(bin, p), "#!/bin/sh\n", { mode: 0o755 });
  return { dir, probe: { platform: "darwin", env: { PATH: "/usr/bin:/bin", HOME: dir } } };
}

/** engine.account.resolve as the policy answers it: the person's accounts in the order they are tried, minus the ones named in `unavailable`. */
const resolver = (order: ResolvedAccount[]) => async (q: AccountQuery): Promise<ResolvedAccount | null> => order.find((a) => !(q.unavailable ?? []).includes(a.ref)) ?? null;

function rig(o: { programs: string[]; order: ResolvedAccount[]; accountsList?: string[] }) {
  const h = home(o.programs);
  const started: string[][] = [];
  const looked: string[] = [];
  const posted: Array<{ threadId: string; blocks: unknown[] }> = [];
  const value = (v: string, itemId: string): Lookup => ({ kind: "value", itemId, value: v, spaceOnly: false, injectIntoDeployments: false });
  const source: ValueSource = { lookup: async (hd) => { looked.push(hd); return hd === "#Dana_Claude.setup_token" ? value(CLAUDE_KEY, "vit_claude") : { kind: "unknown" }; } };
  const session = { source, reportMiss: () => undefined, mcp: { mint: async () => ({ sessionId: "ses_1", sessionToken: "vys_token_1_0123456789abcdef0123456789", url: "http://127.0.0.1:41800/mcp", expiresAt: 9_999_999_999_999 }), close: async () => undefined } };
  const local = createLocalLauncher({ wrap: (argv) => [process.execPath, FAKE_CLI, ...argv], baseEnv: { PATH: process.env["PATH"] ?? "" } });
  // the same check the Space's own launcher makes (session.ts buildOpener), then the fake CLI in place of the program
  const launcher = { async spawn(spec: Parameters<typeof local.spawn>[0]) { refuseMissingProgram(spec.argv[0] ?? "", h.probe); started.push([...spec.argv]); return local.spawn(spec); } };
  const opener = buildNodeOpener({ session, call: async () => ({}) }, launcher);
  const resolveAccount = createRunnableAccount({
    call: async (cap) => (cap === "engine.accounts.list" ? { accounts: (o.accountsList ?? o.order.map((a) => a.ref)).map((ref) => ({ ref })) } : { placement: "host", reason: "default" }),
    resolve: resolver(o.order), probe: h.probe,
    postAs: async (_agent, post) => { posted.push({ threadId: (post as { threadId: string }).threadId, blocks: (post as { blocks: unknown[] }).blocks }); return undefined as never; },
  });
  let n = 0;
  const engine = createTurnEngine({
    holder: "host:s",
    resolveAccount,
    openSession: checkedOpen((spec: SessionSpec) => opener.openSession({ ...spec, turnId: spec.turnId || `turn_${++n}`, traceId: TRACE } as SessionSpec), { probe: h.probe }),
  });
  engine.openThread({ id: "T1", kind: "chat", starter: "dana", agents: [AGENT] });
  return { engine, started, looked, posted, opener };
}

test("the Codex account cannot run here, so the turn is answered by Claude and the chat says so once", async () => {
  const r = rig({ programs: ["claude"], order: [CODEX, CLAUDE] });
  try {
    r.engine.receive({ threadId: "T1", author: { kind: "person", id: "dana" }, body: "hello" });
    await r.engine.idle("T1");
    const turn = r.engine.turns("T1").at(-1);
    assert.equal(turn?.state, "completed", JSON.stringify(r.engine.events().filter((e) => e.type === "turn.failed")));
    assert.ok((r.engine.messages("T1").filter((m) => m.author.kind === "agent").at(-1)?.body ?? "").includes("Hello from the fake engine."), "Claude's engine answered");
    assert.deepEqual(r.started.map((a) => path.basename(a[0] ?? "")), ["claude"], "no codex process was started");
    assert.deepEqual(r.looked.filter((h) => h.includes("Codex")), [], "the Codex account's key was never read from the Vault");
    assert.deepEqual(r.posted.map((p) => p.blocks), [[{ type: "turn_status", v: 1, data: { state: "note", text: "Codex is not installed here, so Claude answered." } }]], "one line in the chat");

    r.engine.receive({ threadId: "T1", author: { kind: "person", id: "dana" }, body: "again" });
    await r.engine.idle("T1");
    assert.equal(r.engine.turns("T1").at(-1)?.state, "completed");
    assert.equal(r.posted.length, 1, "the same change is not announced on every message");
  } finally { await r.opener.close(); }
});

test("with nothing installed the turn fails with engine.cli_missing naming the program, and no engine and no key are touched", async () => {
  const r = rig({ programs: [], order: [CODEX] });
  try {
    r.engine.receive({ threadId: "T1", author: { kind: "person", id: "dana" }, body: "hello" });
    await r.engine.idle("T1");
    const failed = r.engine.events().filter((e) => e.type === "turn.failed").at(-1) as { code?: string; message?: string } | undefined;
    assert.equal(failed?.code, "engine.cli_missing");
    assert.match(failed?.message ?? "", /^codex is not installed/);
    assert.deepEqual(r.started, []);
    assert.deepEqual(r.looked, [], "the Vault was not asked for a key");
    assert.equal(r.posted.length, 0, "nobody answered, so there is no change to announce");
  } finally { await r.opener.close(); }
});

test("a spawn without the program is a precise LaunchError, never the sandbox's execvp failure", () => {
  const h = home(["claude"]);
  assert.throws(() => refuseMissingProgram("codex", h.probe), (e: unknown) => e instanceof LaunchError && e.code === "engine.cli_missing" && e.message === "codex is not installed on this computer.");
  assert.doesNotThrow(() => refuseMissingProgram("claude", h.probe), "found in ~/.local/bin");
  assert.doesNotThrow(() => refuseMissingProgram("node", h.probe), "only the CLI engines are checked");
});
