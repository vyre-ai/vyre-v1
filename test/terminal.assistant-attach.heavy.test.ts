// @heavy docker
// Release gate, 12 Nov (lane f-gate, finding 2): the Owner of a Personal Space opens its Assistant's workspace terminal (the row in Terminals that the Assistant's own command made), on a
// Personal Space run by a server daemon (role space, as the gate ran it) and by a computer's daemon (role space,device). The attach must answer, never a refusal.
// Needs Docker (VYRE_HEAVY_DOCKER=1); VYRE_WORKSPACE_TEST_IMAGE names an image built from images/agent-workspace.
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

async function scenario(t: import("node:test").TestContext, roles: string): Promise<void> {
  const savedImage = process.env["VYRE_WORKSPACE_IMAGE"];
  process.env["VYRE_WORKSPACE_IMAGE"] = IMAGE;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-asst-"));
  const d = await boot(dir, standIn, undefined, {
    config: loadConfig(
      [
        "--data-dir",
        dir,
        "--port",
        "0",
        "--space",
        "spc_asst",
        "--space-name",
        "Personal",
        "--space-kind",
        "personal",
        "--role",
        roles,
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
        spaceId: "spc_asst",
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
  // the Personal Space's own Assistant, as the gate used it
  const me = (await call(d, token, "identity.whoami", {})).data.principal.id as string;
  const agent = await waitFor(async () => {
    await d.hooks?.pump?.();
    const r = await call(d, token, "agents.assistant_of", { personId: me });
    return typeof r.data?.agentId === "string" ? (r.data.agentId as string) : null;
  }, 40_000);
  name = `vyre-ws-${agent}`;
  const threadId = (await ok(d, token, "chat.start", { kind: "chat", agentIds: [agent] })).thread.threadId as string;
  await ok(d, token, "threads.set_mode", { threadId, mode: "auto" });
  await ok(d, token, "chat.post", {
    threadId,
    body: `TOOL terminal_run ${JSON.stringify({ command: "echo hi", idempotencyKey: "asst-echo" })}`,
    mentions: [{ kind: "agent", id: agent }],
  });
  const said = await waitFor(async () => {
    await d.hooks?.pump?.();
    const m =
      ((await call(d, token, "chat.messages.list", { threadId })).data.messages as
        | Array<{ author?: { kind?: string }; body?: string }>
        | undefined) ?? [];
    return m.find((x) => x.author?.kind === "agent" && /TOOL RESULT/.test(x.body ?? ""))?.body ?? null;
  }, 120_000);
  assert.match(said, /TOOL RESULT ok/, said);
  const rows = (await ok(d, token, "terminal.list", { section: "personal" })).terminals as Array<{
    terminalId: string;
    host: string;
    agentId?: string;
  }>;
  const row = rows.find((x) => x.agentId === agent);
  assert.ok(row, JSON.stringify(rows));
  // the Owner opens that row
  const att = await call(d, token, "terminal.attach", { terminalId: row.terminalId });
  assert.equal(
    att.status,
    200,
    `${roles}: the Owner attaches to the Assistant's workspace: ${JSON.stringify(att.data)}`,
  );
  // as the app's attach does next (apps/app/src/places/chats/terminal/session.ts attach): the first read, then a live read
  const r1 = await call(d, token, "terminal.read", { terminalId: row.terminalId, lines: 1 });
  assert.equal(r1.status, 200, `${roles}: read: ${JSON.stringify(r1.data)}`);
  const r2 = await call(d, token, "terminal.read", {
    terminalId: row.terminalId,
    since: (r1.data as { next: number }).next,
  });
  assert.equal(r2.status, 200, `${roles}: live read: ${JSON.stringify(r2.data)}`);
  const ws = await call(d, token, "terminal.workspace", { agentId: agent });
  assert.equal(ws.status, 200, JSON.stringify(ws.data));
  console.log(`WS ${roles} ${JSON.stringify(ws.data)}`);
}

test(
  "Personal Space on a server daemon (as the gate ran it): the Owner opens the Assistant's workspace terminal",
  { skip, timeout: 600_000 },
  (t) => scenario(t, "space"),
);
test(
  "Personal Space on a computer's daemon: the Owner opens the Assistant's workspace terminal",
  { skip, timeout: 600_000 },
  (t) => scenario(t, "space,device"),
);
