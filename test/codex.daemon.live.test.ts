// Codex for real in a booted daemon (lane l-codex, 6 Nov 2026): the real engine, the real CLI driver, the real Vault fill, the real bubblewrap sandbox with its network wall, and the real `codex` program.
// The Personal Space takes the Codex sign-in already on this computer ("Use the sign-in on this computer"): that reads auth.json from VYRE_TEST_CODEX_HOME into the test's own throwaway Vault, so it runs
// only when VYRE_TEST_CODEX_VAULT_IMPORT=1 says that copy is allowed, on Linux with bubblewrap. Otherwise it is SKIPPED with that reason, never passed. The data folder, and the copy with it, is removed at the end.
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

type Any = any;   // eslint-disable-line @typescript-eslint/no-explicit-any
const HOME = process.env["VYRE_TEST_CODEX_HOME"] ?? "";
const why = HOME === "" || !fs.existsSync(path.join(HOME, "auth.json")) ? "VYRE_TEST_CODEX_HOME names no signed-in Codex home"
  : process.env["VYRE_TEST_CODEX_VAULT_IMPORT"] !== "1" ? "VYRE_TEST_CODEX_VAULT_IMPORT=1 is not set: this test copies the sign-in into a throwaway Vault"
  : process.platform !== "linux" || !["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"].some((p) => fs.existsSync(p)) ? "this test runs the bubblewrap sandbox: Linux with bwrap"
  : spawnSync("codex", ["--version"]).status !== 0 ? "the codex program is not installed here" : false;

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-codex-daemon-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}
const find = (root: string, name: string): string | null => {
  for (const e of fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : []) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) { const r = find(p, name); if (r) return r; } else if (e.name === name) return p;
  }
  return null;
};

test("a chat on a Codex sign-in: a plain turn, a turn that runs a command and writes a file in the agent's folder, and a turn that resumes the same Codex session", { skip: why, timeout: 110_000 }, async () => {
  process.env["CODEX_HOME"] = HOME;   // the reader of "the sign-in on this computer" looks here
  const dir = seededDir();
  const d: Daemon = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space-kind", "personal"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "codex-daemon", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const ok = async (cap: string, input: unknown): Promise<Any> => {
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input), signal: AbortSignal.timeout(20_000) });
    const body = (await r.json()) as { data?: unknown };
    assert.equal(r.status, 200, `${cap}: ${JSON.stringify(body)}`);
    return body.data ?? body;
  };
  const log = (): string => { d.sink.flush(); return JSON.stringify(new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, msg, attrs FROM logs WHERE level >= 20 AND msg != 'invoke' ORDER BY id DESC LIMIT 12").all()); };
  const until = async <T>(f: () => Promise<T | null>, why2: () => string, ms = 60_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) { await d.hooks?.pump?.(); const v = await f(); if (v !== null) return v; if (Date.now() > end) throw new Error(why2()); await new Promise((r) => setTimeout(r, 300)); }
  };
  try {
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 7).toString("base64") }) });
    assert.equal(unlock.status, 204);
    const started = await ok("providers.subscription_start", { providerKey: "codex", local: true, idempotencyKey: "cd-start" });
    const provider = (await ok("providers.subscription_complete", { flowId: started.flowId })).provider;
    const item = ((await ok("vault.items.list", {})).items as Any[]).find((i) => i.kind === "ai_subscription")!;
    await ok("providers.set_space_use", { idempotencyKey: "cd-space", providerId: provider.id, allow: true });
    await ok("settings.set_space", { key: "memory.learn_daily_passes", value: 0 });
    const agentId = (await ok("agents.create", { name: "Coder", role: "You write code. Answer briefly.", idempotencyKey: "cd-agent" })).agent.agentId as string;
    const threadId = (await ok("chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "cd-chat" })).thread.threadId as string;
    await ok("threads.agent.configure", { threadId, agentId, accountRef: item.handle });
    let n = 0;
    const ask = async (body: string): Promise<string> => {
      const before = ((await ok("chat.messages.list", { threadId })).messages as Any[]).length;
      await ok("chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `cd-post-${++n}` });
      let seen: unknown = null;
      return until(async () => {
        const all = ((await ok("chat.messages.list", { threadId })).messages as Any[]).slice(before);
        seen = all.map((x) => ({ author: x.author?.kind, body: String(x.body ?? "").slice(0, 160), blocks: (x.blocks ?? []).map((b: Any) => `${b.type}:${JSON.stringify(b.data).slice(0, 200)}`) }));
        const m = all.find((x) => x.author?.kind === "agent" && (x.body ?? "") !== "");
        return m ? String(m.body) : null;
      }, () => `no reply to "${body}": ${JSON.stringify(seen)} ${log().slice(0, 2500)}`);
    };
    assert.match(await ask("What is 2+3? Answer with just the number."), /\b5\b|five/i);
    await ask("Run the shell command `echo daemon-ok`, then create a file named hello.txt in the current folder containing the word sandboxed. Then say done.");
    const made = find(path.join(dir, "work"), "hello.txt");
    assert.ok(made, `Codex wrote hello.txt in the agent's work folder; ${log().slice(0, 2000)}`);
    assert.equal(fs.readFileSync(made, "utf8").trim(), "sandboxed");
    assert.match(await ask("What word is in hello.txt? Answer with just the word."), /sandboxed/i);
    const turns = (await ok("engine.turns.list", { threadId })).turns as Any[];
    assert.ok(turns.length >= 3 && turns.every((t) => t.state === "completed"), `all turns completed: ${JSON.stringify(turns.map((t) => [t.state, t.error?.code]))}`);
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
