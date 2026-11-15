// @heavy docker
// Release gate, 12 Nov (lane f-gate, job C6; the stand-in now ends a stopped turn as a killed model process does, test/memory-live-kit.ts): an agent runs `sleep 120` in its workspace through terminal_run, the person presses Stop, and the agent's next command (echo next-ok) answers
// within seconds in a usable shell, on a real daemon with real Docker and the stand-in model. Needs VYRE_HEAVY_DOCKER=1; VYRE_WORKSPACE_TEST_IMAGE names an image built from images/agent-workspace.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { boot, standIn, waitFor } from "./memory-live-kit.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import { boundWorkspaces } from "../modules/terminal/impl.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the workspace is a real container)";
const PRESET = process.env["VYRE_WORKSPACE_TEST_IMAGE"];
const IMAGE = PRESET ?? `vyre/agent-workspace:daemon-${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake
const KEYS = {
  personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk",
  publicKey: "cHVibGljLWtleQ==",
  privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk",
  spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }],
};
const PASSWORD = "correct horse battery staple 9";

function docker(args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      "docker",
      args,
      { cwd: CODE_ROOT, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (((err as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1) : 0,
          out: `${stdout}\n${stderr}`,
        });
      },
    );
  });
}
type Reply = { status: number; data: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(d: Daemon, token: string | null, cap: string, input: unknown): Promise<Reply> {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(input),
  });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
let keys = 0;
const ok = async (d: Daemon, token: string, cap: string, input: Record<string, unknown>): Promise<any> => {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, token, cap, { idempotencyKey: `ws-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

test(
  "Stop during sleep 120: the command is interrupted and the next command answers within seconds",
  { skip, timeout: 600_000 },
  async (t) => {
    const savedImage = process.env["VYRE_WORKSPACE_IMAGE"];
    process.env["VYRE_WORKSPACE_IMAGE"] = IMAGE;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-stop-"));
    const d = await boot(dir, standIn, undefined, {
      config: loadConfig(
        [
          "--data-dir",
          dir,
          "--port",
          "0",
          "--space",
          "spc_stop",
          "--space-name",
          "Personal",
          "--space-kind",
          "personal",
          "--role",
          "space,device",
        ],
        {},
        "1.2.3",
      ),
      computersHomeIntervalMs: 300,
      workspaceIdleMs: 600_000,
    });
    let name = "";
    t.after(async () => {
      process.env["VYRE_WORKSPACE_IMAGE"] = savedImage ?? "";
      if (savedImage === undefined) delete process.env["VYRE_WORKSPACE_IMAGE"];
      await d.stop();
      if (name !== "") {
        await docker(["rm", "-f", name], 60_000);
        await docker(["volume", "rm", "-f", `${name}-home`, `${name}-files`, `${name}-people`], 60_000);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    const device = { deviceName: "Dana's Mac", deviceClass: "desktop" };
    assert.equal(
      (
        await call(d, null, "identity.claim_owner", {
          code,
          spaceId: "spc_stop",
          username: "dana",
          displayName: "Dana Reyes",
          password: PASSWORD,
          ...device,
          keys: KEYS,
        })
      ).status,
      200,
    );
    const token = (
      (await call(d, null, "identity.sign_in", { username: "dana", password: PASSWORD, ...device })).data.session as {
        token: string;
      }
    ).token;
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ key: Buffer.alloc(32, 7).toString("base64") }),
    });
    assert.equal(unlock.status, 204);
    const folder = await ok(d, token, "vault.folders.create", { name: "Accounts", scope: "mine" });
    const flow = await ok(d, token, "providers.subscription_start", { providerKey: "claude-code" });
    await ok(d, token, "vault.item.put", {
      folderId: folder.folder.id,
      name: "Dana_Claude",
      kind: "ai_subscription",
      fields: [{ key: "setup_token", value: KEY, secret: true }],
    });
    await ok(d, token, "providers.subscription_complete", { flowId: flow.flowId });
    const agent = (await ok(d, token, "agents.create", { name: "Dex", role: "You help." })).agent.agentId as string;
    name = `vyre-ws-${agent}`;
    const threadId = (await ok(d, token, "chat.start", { kind: "chat", agentIds: [agent] })).thread.threadId as string;
    await ok(d, token, "threads.set_mode", { threadId, mode: "auto" });
    const results = async (): Promise<string[]> => {
      await d.hooks?.pump?.();
      const m =
        ((await call(d, token, "chat.messages.list", { threadId })).data.messages as
          | Array<{ author?: { kind?: string }; body?: string }>
          | undefined) ?? [];
      return m.filter((x) => x.author?.kind === "agent" && /TOOL RESULT/.test(x.body ?? "")).map((x) => x.body ?? "");
    };
    const post = (command: string, key: string) =>
      ok(d, token, "chat.post", {
        threadId,
        body: `TOOL terminal_run ${JSON.stringify({ command, idempotencyKey: key })}`,
        mentions: [{ kind: "agent", id: agent }],
      });
    // the workspace is made by a first command, so the sleep starts at once
    await post("echo ready", "stop-ready");
    await waitFor(async () => ((await results()).length >= 1 ? true : null), 120_000);
    await post("sleep 120", "stop-sleep");
    // it runs in the workspace's tab
    await waitFor(async () => {
      const r = await docker(["exec", name, "pgrep", "-f", "^sleep 120$"], 10_000);
      return r.code === 0 ? true : null;
    }, 60_000);
    const stopped = await call(d, token, "engine.stop", { threadId, agentId: agent });
    assert.equal(stopped.status, 200, JSON.stringify(stopped.data));
    console.log(`STOPPED ${JSON.stringify(stopped.data)}`);
    try {
      await waitFor(async () => {
        await d.hooks?.pump?.();
        const r = await docker(["exec", name, "pgrep", "-f", "^sleep 120$"], 10_000);
        return r.code !== 0 ? true : null;
      }, 15_000);
    } catch (e) {
      d.sink.flush();
      const { DatabaseSync } = await import("node:sqlite");
      const rows = new DatabaseSync(d.paths.logs, { readOnly: true })
        .prepare(
          "SELECT msg, attrs FROM logs WHERE msg LIKE '%consumer%' OR msg LIKE '%turn%' OR msg LIKE '%terminal%' ORDER BY id DESC LIMIT 25",
        )
        .all();
      console.log(`LOGS ${JSON.stringify(rows).slice(0, 3000)}`);
      throw e;
    }
    const before = (await results()).length;
    const t0 = Date.now();
    await post("echo next-ok", "stop-next");
    let said: string;
    try {
      said = await waitFor(async () => {
        const r = await results();
        return r.length > before ? r.at(-1)! : null;
      }, 60_000);
    } catch (e) {
      const m = (
        (await call(d, token, "chat.messages.list", { threadId })).data.messages as Array<{
          author?: { kind?: string };
          body?: string;
          kind?: string;
        }>
      ).map((x) => `${x.author?.kind}: ${(x.body ?? "").slice(0, 160)}`);
      console.log(`MSGS ${JSON.stringify(m)}`);
      const st = await call(d, token, "terminal.list", { section: "personal" });
      console.log(`TERMS ${JSON.stringify(st.data).slice(0, 800)}`);
      const { DatabaseSync } = await import("node:sqlite");
      for (const f of Object.values(d.paths as Record<string, unknown>).filter(
        (v): v is string => typeof v === "string" && v.endsWith(".db"),
      )) {
        try {
          const db = new DatabaseSync(f, { readOnly: true });
          const q = db.prepare("SELECT thread_id, qseq, state FROM engine_thread_queue ORDER BY qseq").all();
          const tr = db.prepare("SELECT turn_id, state, started_at FROM engine_turns").all();
          console.log(`ENGINE ${f} queue ${JSON.stringify(q)} turns ${JSON.stringify(tr)}`);
        } catch {
          /* not this file */
        }
      }
      throw e;
    }
    const ms = Date.now() - t0;
    assert.match(said, /next-ok/, said);
    assert.ok(ms < 20_000, `the next command answered in ${ms} ms, not after the sleep`);
    console.log(`STOP-NEXT ${ms} ms`);
  },
);

test(
  "a session an agent's command opens is readable by its owner while that first command still runs, and after it was stopped",
  { skip, timeout: 600_000 },
  async (t) => {
    const savedImage = process.env["VYRE_WORKSPACE_IMAGE"];
    process.env["VYRE_WORKSPACE_IMAGE"] = IMAGE;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-open-"));
    const d = await boot(dir, standIn, undefined, {
      config: loadConfig(
        [
          "--data-dir",
          dir,
          "--port",
          "0",
          "--space",
          "spc_open",
          "--space-name",
          "Personal",
          "--space-kind",
          "personal",
          "--role",
          "space,device",
        ],
        {},
        "1.2.3",
      ),
      computersHomeIntervalMs: 300,
      workspaceIdleMs: 600_000,
    });
    let name = "";
    t.after(async () => {
      process.env["VYRE_WORKSPACE_IMAGE"] = savedImage ?? "";
      if (savedImage === undefined) delete process.env["VYRE_WORKSPACE_IMAGE"];
      await d.stop();
      if (name !== "") {
        await docker(["rm", "-f", name], 60_000);
        await docker(["volume", "rm", "-f", `${name}-home`, `${name}-files`, `${name}-people`], 60_000);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    const device = { deviceName: "Dana's Mac", deviceClass: "desktop" };
    assert.equal(
      (
        await call(d, null, "identity.claim_owner", {
          code,
          spaceId: "spc_open",
          username: "dana",
          displayName: "Dana Reyes",
          password: PASSWORD,
          ...device,
          keys: KEYS,
        })
      ).status,
      200,
    );
    const token = (
      (await call(d, null, "identity.sign_in", { username: "dana", password: PASSWORD, ...device })).data.session as {
        token: string;
      }
    ).token;
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ key: Buffer.alloc(32, 7).toString("base64") }),
    });
    assert.equal(unlock.status, 204);
    const folder = await ok(d, token, "vault.folders.create", { name: "Accounts", scope: "mine" });
    const flow = await ok(d, token, "providers.subscription_start", { providerKey: "claude-code" });
    await ok(d, token, "vault.item.put", {
      folderId: folder.folder.id,
      name: "Dana_Claude",
      kind: "ai_subscription",
      fields: [{ key: "setup_token", value: KEY, secret: true }],
    });
    await ok(d, token, "providers.subscription_complete", { flowId: flow.flowId });
    const agent = (await ok(d, token, "agents.create", { name: "Dex", role: "You help." })).agent.agentId as string;
    name = `vyre-ws-${agent}`;
    const threadId = (await ok(d, token, "chat.start", { kind: "chat", agentIds: [agent] })).thread.threadId as string;
    await ok(d, token, "threads.set_mode", { threadId, mode: "auto" });
    const post = (command: string, key: string, session?: string) =>
      ok(d, token, "chat.post", {
        threadId,
        body: `TOOL terminal_run ${JSON.stringify({ command, ...(session ? { session } : {}), idempotencyKey: key })}`,
        mentions: [{ kind: "agent", id: agent }],
      });
    // the first command in a new tab runs long
    await post("sleep 25", "open-long", "long");
    const row = await waitFor(async () => {
      await d.hooks?.pump?.();
      const r = (await ok(d, token, "terminal.list", { section: "personal" })).terminals as Array<{
        terminalId: string;
        name: string;
      }>;
      return r.find((x) => x.name === "long") ?? null;
    }, 60_000);
    const get = await call(d, token, "terminal.get", { terminalId: row.terminalId });
    const att = await call(d, token, "terminal.attach", { terminalId: row.terminalId });
    console.log(`MIDRUN get ${get.status} attach ${att.status} ${JSON.stringify(get.data).slice(0, 200)}`);
    assert.deepEqual(
      [get.status, att.status],
      [200, 200],
      "the owner reads the tab the agent's first command opened, while it runs",
    );
    // stopped mid-command: still readable
    await call(d, token, "engine.stop", { threadId, agentId: agent });
    await new Promise((r) => setTimeout(r, 2000));
    await d.hooks?.pump?.();
    const after = await call(d, token, "terminal.get", { terminalId: row.terminalId });
    assert.equal(after.status, 200, `after the Stop: ${JSON.stringify(after.data).slice(0, 200)}`);
  },
);

test(
  "a tab that already ran a command and is busy with a later long one is readable by its owner",
  { skip, timeout: 600_000 },
  async (t) => {
    const savedImage = process.env["VYRE_WORKSPACE_IMAGE"];
    process.env["VYRE_WORKSPACE_IMAGE"] = IMAGE;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-busy-"));
    const d = await boot(dir, standIn, undefined, {
      config: loadConfig(
        [
          "--data-dir",
          dir,
          "--port",
          "0",
          "--space",
          "spc_busy",
          "--space-name",
          "Personal",
          "--space-kind",
          "personal",
          "--role",
          "space,device",
        ],
        {},
        "1.2.3",
      ),
      computersHomeIntervalMs: 300,
      workspaceIdleMs: 600_000,
    });
    let name = "";
    t.after(async () => {
      process.env["VYRE_WORKSPACE_IMAGE"] = savedImage ?? "";
      if (savedImage === undefined) delete process.env["VYRE_WORKSPACE_IMAGE"];
      await d.stop();
      if (name !== "") {
        await docker(["rm", "-f", name], 60_000);
        await docker(["volume", "rm", "-f", `${name}-home`, `${name}-files`, `${name}-people`], 60_000);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    const device = { deviceName: "Dana's Mac", deviceClass: "desktop" };
    assert.equal(
      (
        await call(d, null, "identity.claim_owner", {
          code,
          spaceId: "spc_busy",
          username: "dana",
          displayName: "Dana Reyes",
          password: PASSWORD,
          ...device,
          keys: KEYS,
        })
      ).status,
      200,
    );
    const token = (
      (await call(d, null, "identity.sign_in", { username: "dana", password: PASSWORD, ...device })).data.session as {
        token: string;
      }
    ).token;
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ key: Buffer.alloc(32, 7).toString("base64") }),
    });
    assert.equal(unlock.status, 204);
    const folder = await ok(d, token, "vault.folders.create", { name: "Accounts", scope: "mine" });
    const flow = await ok(d, token, "providers.subscription_start", { providerKey: "claude-code" });
    await ok(d, token, "vault.item.put", {
      folderId: folder.folder.id,
      name: "Dana_Claude",
      kind: "ai_subscription",
      fields: [{ key: "setup_token", value: KEY, secret: true }],
    });
    await ok(d, token, "providers.subscription_complete", { flowId: flow.flowId });
    const agent = (await ok(d, token, "agents.create", { name: "Dex", role: "You help." })).agent.agentId as string;
    name = `vyre-ws-${agent}`;
    const threadId = (await ok(d, token, "chat.start", { kind: "chat", agentIds: [agent] })).thread.threadId as string;
    await ok(d, token, "threads.set_mode", { threadId, mode: "auto" });
    const results = async (): Promise<number> => {
      await d.hooks?.pump?.();
      const m =
        ((await call(d, token, "chat.messages.list", { threadId })).data.messages as
          | Array<{ author?: { kind?: string }; body?: string }>
          | undefined) ?? [];
      return m.filter((x) => x.author?.kind === "agent" && /TOOL RESULT/.test(x.body ?? "")).length;
    };
    const post = (command: string, key: string) =>
      ok(d, token, "chat.post", {
        threadId,
        body: `TOOL terminal_run ${JSON.stringify({ command, session: "busy", idempotencyKey: key })}`,
        mentions: [{ kind: "agent", id: agent }],
      });
    await post("echo first", "busy-first");
    await waitFor(async () => ((await results()) >= 1 ? true : null), 120_000);
    const row = (
      (await ok(d, token, "terminal.list", { section: "personal" })).terminals as Array<{
        terminalId: string;
        name: string;
      }>
    ).find((x) => x.name === "busy");
    assert.ok(row);
    await post("sleep 20", "busy-long");
    await waitFor(async () => {
      const r = await docker(["exec", name, "pgrep", "-f", "^sleep 20$"], 10_000);
      return r.code === 0 ? true : null;
    }, 60_000);
    const g = await call(d, token, "terminal.get", { terminalId: row.terminalId });
    const a = await call(d, token, "terminal.attach", { terminalId: row.terminalId });
    console.log(`BUSY get ${g.status} attach ${a.status}`);
    assert.deepEqual([g.status, a.status], [200, 200], "busy with a later command, the tab is readable by its owner");
    // the turn ends before the daemon stops (a test daemon stopped mid-turn trips over its closed database)
    await docker(["exec", name, "pkill", "-f", "^sleep 20$"], 10_000);
    await waitFor(async () => ((await results()) >= 2 ? true : null), 60_000);
  },
);

test(
  "the desktop app stopping its turns for an update (engine.stop_all with reason update) leaves the agent's command running",
  { skip, timeout: 600_000 },
  async (t) => {
    const savedImage = process.env["VYRE_WORKSPACE_IMAGE"];
    process.env["VYRE_WORKSPACE_IMAGE"] = IMAGE;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-upd-"));
    const d = await boot(dir, standIn, undefined, {
      config: loadConfig(
        [
          "--data-dir",
          dir,
          "--port",
          "0",
          "--space",
          "spc_upd",
          "--space-name",
          "Personal",
          "--space-kind",
          "personal",
          "--role",
          "space,device",
        ],
        {},
        "1.2.3",
      ),
      computersHomeIntervalMs: 300,
      workspaceIdleMs: 600_000,
    });
    let name = "";
    t.after(async () => {
      process.env["VYRE_WORKSPACE_IMAGE"] = savedImage ?? "";
      if (savedImage === undefined) delete process.env["VYRE_WORKSPACE_IMAGE"];
      await d.stop();
      if (name !== "") {
        await docker(["rm", "-f", name], 60_000);
        await docker(["volume", "rm", "-f", `${name}-home`, `${name}-files`, `${name}-people`], 60_000);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    const device = { deviceName: "Dana's Mac", deviceClass: "desktop" };
    assert.equal(
      (
        await call(d, null, "identity.claim_owner", {
          code,
          spaceId: "spc_upd",
          username: "dana",
          displayName: "Dana Reyes",
          password: PASSWORD,
          ...device,
          keys: KEYS,
        })
      ).status,
      200,
    );
    const token = (
      (await call(d, null, "identity.sign_in", { username: "dana", password: PASSWORD, ...device })).data.session as {
        token: string;
      }
    ).token;
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ key: Buffer.alloc(32, 7).toString("base64") }),
    });
    assert.equal(unlock.status, 204);
    const folder = await ok(d, token, "vault.folders.create", { name: "Accounts", scope: "mine" });
    const flow = await ok(d, token, "providers.subscription_start", { providerKey: "claude-code" });
    await ok(d, token, "vault.item.put", {
      folderId: folder.folder.id,
      name: "Dana_Claude",
      kind: "ai_subscription",
      fields: [{ key: "setup_token", value: KEY, secret: true }],
    });
    await ok(d, token, "providers.subscription_complete", { flowId: flow.flowId });
    const agent = (await ok(d, token, "agents.create", { name: "Dex", role: "You help." })).agent.agentId as string;
    name = `vyre-ws-${agent}`;
    const threadId = (await ok(d, token, "chat.start", { kind: "chat", agentIds: [agent] })).thread.threadId as string;
    await ok(d, token, "threads.set_mode", { threadId, mode: "auto" });
    const results = async (): Promise<number> => {
      await d.hooks?.pump?.();
      const m =
        ((await call(d, token, "chat.messages.list", { threadId })).data.messages as
          | Array<{ author?: { kind?: string }; body?: string }>
          | undefined) ?? [];
      return m.filter((x) => x.author?.kind === "agent" && /TOOL RESULT/.test(x.body ?? "")).length;
    };
    const post = (command: string, key: string) =>
      ok(d, token, "chat.post", {
        threadId,
        body: `TOOL terminal_run ${JSON.stringify({ command, idempotencyKey: key })}`,
        mentions: [{ kind: "agent", id: agent }],
      });
    await post("echo ready", "upd-ready");
    await waitFor(async () => ((await results()) >= 1 ? true : null), 120_000);
    await post("sleep 40", "upd-sleep");
    await waitFor(async () => {
      const r = await docker(["exec", name, "pgrep", "-f", "^sleep 40$"], 10_000);
      return r.code === 0 ? true : null;
    }, 60_000);
    const upd = await call(d, token, "engine.stop_all", { threadId, reason: "update", idempotencyKey: "upd-stop" });
    assert.equal(upd.status, 200, JSON.stringify(upd.data));
    for (let i = 0; i < 8; i++) {
      await d.hooks?.pump?.();
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(
      (await docker(["exec", name, "pgrep", "-f", "^sleep 40$"], 10_000)).code,
      0,
      "an update's stop leaves the command running",
    );
    await docker(["exec", name, "pkill", "-f", "^sleep 40$"], 10_000);
    await new Promise((r) => setTimeout(r, 1500));
  },
);
