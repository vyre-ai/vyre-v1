// AI accounts per agent on a booted daemon (memory ruling 6): an agent's chat key and ORDERED fallback list are walked in order when an account is refused, then the Space backups; the
// Memory key, the Space key, a project's key and a person's key resolve for the scope they pay for, picked only from accounts the picker may use. Nothing is faked inside the daemon but the
// model vendor: a scripted session refuses the accounts a test names and answers on the first one that is not refused.
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

interface Spec { account?: { ref: string } }
type Ev = { type: "text"; text: string } | { type: "error"; code: string; message: string } | { type: "done" };
/** The model vendor: refuses the accounts in `refused` with a rate limit, answers "served by <ref>" on any other, and remembers the order it was opened in. */
function vendor(refused: Set<string>, opened: string[]): (spec: unknown) => Promise<unknown> {
  return async (spec: unknown) => {
    const ref = (spec as Spec).account?.ref ?? "none";
    opened.push(ref);
    return {
      warm: true,
      async *send(): AsyncGenerator<Ev> {
        if (refused.has(ref)) yield { type: "error", code: "provider.rate_limited", message: `${ref} is out of quota` };
        else { yield { type: "text", text: `served by ${ref}` }; yield { type: "done" }; }
      },
      sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
    };
  };
}

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-accounts-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

async function boot(dir: string, openSession: unknown): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "accounts-live", free: 80e9,
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
      return ["usr_olivia", "usr_adam", "usr_noah"].includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "accounts-live" } : null;
    },
    engineOpenSession: openSession,
  });
}

async function call(d: Daemon, cap: string, input: unknown, who = "usr_olivia"): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

function hostLog(d: Daemon): string {
  d.sink.flush();
  const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, msg, attrs FROM logs WHERE level >= 30 ORDER BY id DESC LIMIT 12").all() as Array<{ level: number; place?: string; msg: string; attrs?: string }>;
  return JSON.stringify(rows.filter((r) => !/grants on an agent|neighbour|principal could not be adopted/.test(r.msg)).map((r) => `${r.place ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 300)}`));
}

async function reply(d: Daemon, agentId: string, body: string, key: string, expect: "reply" | "none" = "reply"): Promise<string | null> {
  const started = await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `${key}-s` });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  const threadId = started.data.thread.threadId as string;
  assert.equal((await call(d, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `${key}-p` })).status, 200);
  const end = Date.now() + (expect === "reply" ? 30_000 : 6_000);
  for (;;) {
    await d.hooks?.pump?.();
    const m = ((await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined)?.find((x) => x.author?.kind === "agent" && (x.body ?? "") !== "");
    if (m?.body) return m.body;
    if (Date.now() > end) { if (expect === "none") return null; throw new Error(`no reply; host log ${hostLog(d)}`); }
    await new Promise<void>((r) => setTimeout(r, 200));
  }
}

async function sharedKeys(d: Daemon, names: string[]): Promise<Record<string, string>> {
  const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer usr_olivia" }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
  assert.equal(unlock.status, 204, `unlock: ${unlock.status}`);
  const folder = await call(d, "vault.folders.create", { idempotencyKey: "ac-folder", name: "Team keys", scope: "shared" });
  assert.equal(folder.status, 200, JSON.stringify(folder.data));
  const out: Record<string, string> = {};
  for (const n of names) {
    const p = await call(d, "providers.add", { idempotencyKey: `ac-${n}`, providerKey: "anthropic", connection: "api_key", apiKey: `${KEY}${n}`, name: `Team ${n}`, scope: "shared", folderId: folder.data.folder.id });
    assert.equal(p.status, 200, JSON.stringify(p.data));
    out[n] = p.data.provider.handle as string;
  }
  assert.equal((await call(d, "engine.pool.status", {})).status, 200);
  return out;
}

test("accounts live: the chat key, then the agent's ordered fallbacks in order, then the Space backups; each refused account is skipped", async () => {
  const refused = new Set<string>();
  const opened: string[] = [];
  const d = await boot(seededDir(), vendor(refused, opened));
  try {
    const k = await sharedKeys(d, ["A", "B", "C", "D", "E"]);
    const made = await call(d, "agents.create", { name: "Keeper", role: "You answer intake questions.", idempotencyKey: "ac-agent" });
    const agentId = made.data.agent.agentId as string;
    const set = await call(d, "agents.update", { agentId, patch: { accountPolicy: "key", accountKey: k["A"], accountFallback: [k["C"], k["B"], k["D"]], memoryKey: k["E"] }, idempotencyKey: "ac-set" });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    assert.deepEqual([set.data.agent.accountKey, set.data.agent.accountFallback, set.data.agent.memoryKey], [k["A"], [k["C"], k["B"], k["D"]], k["E"]]);
    // the Space's own backups come after the agent's list
    const defaults = await call(d, "engine.defaults.set", { fallback: [{ provider: "anthropic", model: "claude-haiku-5-5", accountRef: k["E"] }] });
    assert.equal(defaults.status, 200, JSON.stringify(defaults.data));

    // the chat key serves while it works
    assert.equal(await reply(d, agentId, "hello one", "ac1"), `served by ${k["A"]}`);
    assert.deepEqual(opened, [k["A"]]);

    // the chat key is refused: the first fallback in the list serves, not the first one connected
    opened.length = 0;
    refused.add(k["A"]!);
    assert.equal(await reply(d, agentId, "hello two", "ac2"), `served by ${k["C"]}`);
    assert.deepEqual(opened, [k["A"], k["C"]], "chat key, then fallback 1");

    // fallback 1 is refused too: fallback 2, then fallback 3, in the order they were listed
    opened.length = 0;
    refused.add(k["C"]!);
    refused.add(k["B"]!);
    assert.equal(await reply(d, agentId, "hello three", "ac3"), `served by ${k["D"]}`);
    assert.deepEqual(opened, [k["A"], k["C"], k["B"], k["D"]], "the list order, not the order the keys were added");

    // the whole list is refused: the Space backup serves
    opened.length = 0;
    refused.add(k["D"]!);
    assert.equal(await reply(d, agentId, "hello four", "ac4"), `served by ${k["E"]}`);
    assert.deepEqual(opened, [k["A"], k["C"], k["B"], k["D"], k["E"]], "agent list first, then the Space backups");

    // nothing is left: no reply, the turn fails with the last refusal
    opened.length = 0;
    refused.add(k["E"]!);
    assert.equal(await reply(d, agentId, "hello five", "ac5", "none"), null);
    assert.deepEqual(opened, [k["A"], k["C"], k["B"], k["D"], k["E"]]);
    assert.match(hostLog(d), /rate_limited/);
  } finally { await d.stop(); }
});

test("accounts live: the Memory key of an agent, the Space key, a project's key and a person's key each resolve for the scope they pay for, picked only from accounts the picker offers", async () => {
  const d = await boot(seededDir(), vendor(new Set(), []));
  try {
    const k = await sharedKeys(d, ["S", "P", "M"]);
    const agentId = (await call(d, "agents.create", { name: "Keeper", role: "You answer intake questions.", idempotencyKey: "ac-agent2" })).data.agent.agentId as string;
    const resolve = async (input: Record<string, unknown>, who = "usr_olivia") => (await call(d, "memory.key.resolve", input, who)).data;
    // nothing picked: rule-based upkeep
    assert.deepEqual(await resolve({ layer: "space", ownerRef: CORE_SPACE }), { reason: "no_key" });

    // the picker offers the shared accounts to an admin and refuses anything else
    const got = await call(d, "memory.keys.get", {});
    assert.equal(got.data.admin, true);
    assert.deepEqual(got.data.space.choices.map((c: { ref: string }) => c.ref).sort(), [k["M"], k["P"], k["S"]].sort());
    const bad = await call(d, "memory.key.set", { layer: "space", accountRef: "#Not_A_Key" });
    assert.equal(bad.status, 422, JSON.stringify(bad.data));
    const noah = await call(d, "memory.keys.get", {}, "usr_noah");
    assert.equal(noah.data.admin, false);
    assert.equal(noah.data.space, undefined, "the Space picker is for admins");
    assert.ok(noah.data.personal.choices.length > 0, "a member still picks their own memory account");
    const refused = await call(d, "memory.key.set", { layer: "space", accountRef: k["S"] }, "usr_noah");
    assert.equal(refused.status, 403, JSON.stringify(refused.data));

    // Space key
    assert.equal((await call(d, "memory.key.set", { layer: "space", accountRef: k["S"] })).status, 200);
    const space = await resolve({ layer: "space", ownerRef: CORE_SPACE });
    assert.deepEqual([space.key.accountRef, space.key.source, space.key.provider], [k["S"], "space", "anthropic"]);
    // an agent with no key of its own pays with the Space's; with its Memory key, with that
    assert.equal((await resolve({ layer: "agent", ownerRef: agentId, agentId })).key.source, "space");
    assert.equal((await call(d, "agents.update", { agentId, patch: { memoryKey: k["M"] }, idempotencyKey: "ac-mk" })).status, 200);
    const agent = await resolve({ layer: "agent", ownerRef: agentId, agentId });
    assert.deepEqual([agent.key.accountRef, agent.key.source], [k["M"], "agent"]);
    // the server itself (the nightly job) asks without seeing the agent page and gets the same answer: tested by the module, since the HTTP caller here is a person
    // a project's own key beats the Space's for project memory
    assert.equal((await call(d, "memory.key.set", { layer: "project", projectId: "prj_rivera", accountRef: k["P"] })).status, 200);
    const project = await resolve({ layer: "project", ownerRef: "prj_rivera", projectId: "prj_rivera" });
    assert.deepEqual([project.key.accountRef, project.key.source], [k["P"], "project"]);
    assert.equal((await resolve({ layer: "project", ownerRef: "prj_other", projectId: "prj_other" })).key.source, "space");
    // a person's own key, for that person's memory only
    assert.equal((await call(d, "memory.key.set", { layer: "person", accountRef: k["P"] })).status, 200);
    assert.equal((await resolve({ layer: "person", ownerRef: "usr_olivia" })).key.accountRef, k["P"]);
    assert.deepEqual(await resolve({ layer: "person", ownerRef: "usr_olivia" }, "usr_noah"), { reason: "no_key" }, "nobody else resolves, or spends, a person's key");
    // clearing goes back to rules only
    assert.equal((await call(d, "memory.key.set", { layer: "space", accountRef: null })).status, 200);
    assert.deepEqual(await resolve({ layer: "space", ownerRef: CORE_SPACE }), { reason: "no_key" });
  } finally { await d.stop(); }
});
