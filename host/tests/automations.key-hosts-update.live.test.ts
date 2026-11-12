// The update to "a key goes only to an approved host", on data rc.25 left: Automations whose key-bearing HTTP steps were saved before hosts were approved per key. The new code boots on that data
// and backfills once, only for Automations that are on, from the version that runs, saved by a PERSON who may use the key: that step keeps working (its host approved, attributed to them).
// A person's draft and a step only an AGENT saved are not adopted: each shows its state before the Run, and its Run stops with the plain line until a person allows the host; then it runs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon, DaemonOptions } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";
const AGENT = "tok-agent";
const SECRET = "fake_update_key_81";

function boot(dir: string, sent: { host: string; key: boolean }[]): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({ os: "linux", hostname: "key-update", free: 80e9, commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    } }),
    fetch: caddyFetch,
    seams: {
      vaultSinks: { env: () => undefined },
      drivers: {
        setDocumentNetwork: () => ({
          lookup: async () => ["93.184.216.34"],
          fetch: async () => { throw new Error("the pinned connect is used"); },
          connect: async (r: { url: URL; headers?: Record<string, string> }) => {
            sent.push({ host: r.url.hostname, key: Object.values(r.headers ?? {}).some((v) => v.includes(SECRET)) });
            return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
          },
        }),
      },
    },
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      if (t === OWNER) return { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "key-update" };
      if (t === AGENT) return { space: "spc_core", principal: { kind: "agent", id: "agt_scout" }, actingFor: "usr_olivia", device: "key-update" };
      return null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  } satisfies DaemonOptions);
}

test("on update, a step a person saved keeps its host; a step only an agent saved stops with the line until a person allows it", async () => {
  const sent: { host: string; key: boolean }[] = [];
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-key-update-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  let d = await boot(dir, sent);
  const post = async (who: string, cap: string, body: Record<string, unknown>) => {
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify({ idempotencyKey: `${cap}-${Math.random()}`, ...body }), signal: AbortSignal.timeout(8_000) });
    const text = await r.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
    return { status: r.status, data: (json["data"] as Record<string, unknown> | undefined) ?? {}, text };
  };
  const waitRun = async (runId: string): Promise<{ status: string; steps: string; runId: string }> => {
    let status = "";
    for (let i = 0; i < 80 && !["succeeded", "failed", "stopped"].includes(status); i++) {
      status = String(((await post(OWNER, "runs.get", { runId })).data["run"] as { status?: string } | undefined)?.status ?? "");
      if (!["succeeded", "failed", "stopped"].includes(status)) await new Promise((r) => setTimeout(r, 150));
    }
    return { status, steps: (await post(OWNER, "runs.steps", { runId })).text, runId };
  };
  const runAndWait = async (automationId: string): Promise<{ status: string; steps: string; runId: string }> => {
    const run = await post(OWNER, "automations.run", { automationId });
    const runId = String(run.data["runId"] ?? "");
    if (runId) return await waitRun(runId);
    let status = "";
    for (let i = 0; i < 80 && !["succeeded", "failed", "stopped"].includes(status); i++) {
      status = String(((await post(OWNER, "runs.get", { runId })).data["run"] as { status?: string } | undefined)?.status ?? "");
      if (!["succeeded", "failed", "stopped"].includes(status)) await new Promise((r) => setTimeout(r, 150));
    }
    return { status, steps: (await post(OWNER, "runs.steps", { runId })).text, runId };
  };
  try {
    const folder = await post(OWNER, "vault.folders.create", { name: "Keys", scope: "shared" });
    const put = await post(OWNER, "vault.item.put", { folderId: String((folder.data["folder"] as { id?: string }).id), name: "Notely", kind: "api_key", fields: [{ key: "api_key", value: SECRET }] });
    const handle = String((put.data["item"] as { handle?: string }).handle);
    const step = (host: string) => ({ triggers: [{ key: "manual" }], nodes: [{ id: "get", key: "http_request", title: "Get", input: { method: "GET", url: `https://${host}/v1/notes`, auth: { kind: "header", header: "X-Api-Key", handle } } }] });
    // a person's Automation on api.notely.example
    const mine = await post(OWNER, "automations.create", { name: "Person made", definition: step("api.notely.example") });
    assert.equal(mine.status, 200, mine.text);
    const mineId = String((mine.data["automation"] as { id?: string }).id);
    assert.equal((await post(OWNER, "automations.set_enabled", { automationId: mineId, enabled: true })).status, 200, "turned on");
    // a person's draft on draft.notely.example: never turned on, so the backfill leaves it alone
    const draft = await post(OWNER, "automations.create", { name: "Person draft", definition: step("draft.notely.example") });
    assert.equal(draft.status, 200, draft.text);
    // an agent's Automation on agent.notely.example (today the agent needs the host approved to save it; rc.25 let it save with none)
    assert.equal((await post(OWNER, "automations.key_hosts.allow", { vaultItemId: handle, host: "agent.notely.example" })).status, 200);
    const theirs = await post(AGENT, "automations.create", { name: "Agent made", definition: step("agent.notely.example") });
    assert.equal(theirs.status, 200, theirs.text);
    const theirsId = String((theirs.data["automation"] as { id?: string }).id);
    await d.stop();

    // the data rc.25 left: no approved hosts at all, and the backfill never ran
    const modules = new DatabaseSync(path.join(dir, "modules.db"));
    modules.exec("DELETE FROM automations_key_hosts");
    modules.prepare("DELETE FROM automations_policy WHERE policy_key = ?").run("automations.key_hosts_backfilled");
    modules.close();

    // the new code boots on it
    d = await boot(dir, sent);
    let listed: { host: string; by: string }[] = [];
    for (let i = 0; i < 60 && listed.length === 0; i++) {
      listed = ((await post(OWNER, "automations.key_hosts.list", { itemId: handle })).data["hosts"] as { host: string; by: string }[] | undefined) ?? [];
      if (listed.length === 0) await new Promise((r) => setTimeout(r, 150));
    }
    assert.deepEqual(listed.map((h) => [h.host, h.by]), [["api.notely.example", "usr_olivia"]], "only the step of an Automation that is on, saved by a person who may use the key, is adopted, attributed to them");

    const ok = await runAndWait(mineId);
    assert.equal(ok.status, "succeeded", `a person's step keeps working after the update: ${ok.steps.slice(0, 300)}`);
    // the agent's step shows its state before the Run, then its Run stops with the line
    const def = ((await post(OWNER, "automations.get", { automationId: theirsId })).data["automation"] as { definition: unknown }).definition;
    const check = await post(OWNER, "automations.validate", { definition: def, kind: "personal" });
    assert.match(check.text, /is no longer allowed to go to agent\.notely\.example/, check.text);
    const draftId = String((draft.data["automation"] as { id?: string }).id);
    const draftDef = ((await post(OWNER, "automations.get", { automationId: draftId })).data["automation"] as { definition: unknown }).definition;
    assert.match((await post(OWNER, "automations.validate", { definition: draftDef, kind: "personal" })).text, /is no longer allowed to go to draft\.notely\.example/, "a draft is not adopted and says why");
    const usage = await post(OWNER, "automations.vault_usage", { handle });
    assert.match(usage.text, /no longer allowed to go to agent\.notely\.example/, usage.text);
    const stopped = await runAndWait(theirsId);
    assert.equal(stopped.status, "failed", stopped.steps);
    assert.match(stopped.steps, /is no longer allowed to go to agent\.notely\.example\. Allow it again on the key's page, or change this step\./);
    assert.equal(sent.filter((s) => s.key && s.host === "agent.notely.example").length, 0, "the key never went to the host nobody chose");

    // the person who can fix it is told once, with the line
    type Note = { kind?: string; title?: string; subject?: { id?: string } };
    let notes: Note[] = [];
    let told: Note[] = [];
    for (let i = 0; i < 50 && told.length === 0; i++) {
      notes = ((await post(OWNER, "notifications.list", { limit: 50 })).data["notifications"] as Note[] | undefined) ?? [];
      told = notes.filter((n) => n.kind === "run.failed" && n.subject?.id === stopped.runId);
      if (told.length === 0) await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(told.length, 1, `one failed-Run notice: ${JSON.stringify(notes).slice(0, 600)}`);
    assert.match(String(told[0]?.title), /is no longer allowed to go to agent\.notely\.example\. Allow it again on the key's page, or change this step\./, JSON.stringify(told[0]));
    // a person allows it again: Retry on the stopped Run works, then a new Run works
    assert.equal((await post(OWNER, "automations.key_hosts.allow", { vaultItemId: handle, host: "agent.notely.example" })).status, 200);
    const retried = await post(OWNER, "runs.retry", { runId: stopped.runId });
    assert.equal(retried.status, 200, retried.text);
    const again2 = await waitRun(String(retried.data["runId"] ?? ""));
    assert.equal(again2.status, "succeeded", `Retry after the host is allowed: ${again2.steps.slice(0, 300)}`);
    const resumed = await runAndWait(theirsId);
    assert.equal(resumed.status, "succeeded", resumed.steps.slice(0, 300));
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
