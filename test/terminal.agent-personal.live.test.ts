// An agent in a Personal Space runs a command on the person's computer (owner, 2 Nov: "agents should be able to run terminal commands"), on a booted daemon shaped like the desktop app's own:
// role space,device and kind personal. A fresh Space is claimed from a desktop device, a Claude account is connected, and the model stand-in calls terminal_run with no host and no terminal.
// Nothing is bound in this process: the daemon's own seam runs the command on this machine, in tmux when it is installed and in a plain shell when it is not (a Mac ships no tmux).
// The command shows in the agent's session on this computer, listed under Terminals with the person's device.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, standIn, waitFor } from "./memory-live-kit.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";

type Reply = { status: number; data: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(d: Daemon, token: string | null, cap: string, input: unknown): Promise<Reply> {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
let keys = 0;
const ok = async (d: Daemon, token: string, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, token, cap, { idempotencyKey: `ap-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

async function agentRunsHere(o: { tmux: boolean }): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-agentterm-"));
  // without tmux on the PATH this machine is a Mac as shipped: the plain shell runs the command
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-agentterm-bin-"));
  const savedPath = process.env["PATH"];
  if (!o.tmux) process.env["PATH"] = bare;
  // this test is about the person's own computer: a machine that has Docker would give the agent a workspace (test/terminal.workspace.live.test.ts), so the Space here has no runtime
  const d = await boot(dir, standIn, undefined, {
    workspaceRuntimeOff: true,
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_agentterm", "--space-name", "Personal", "--space-kind", "personal", "--role", "space,device"], {}, "1.2.3"),
  });
  try {
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    const device = { deviceName: "Dana's Mac", deviceClass: "desktop" };
    assert.equal((await call(d, null, "identity.claim_owner", { code, spaceId: "spc_agentterm", username: "dana", displayName: "Dana Reyes", password: PASSWORD, ...device, keys: KEYS })).status, 200);
    const signed = (await call(d, null, "identity.sign_in", { username: "dana", password: PASSWORD, ...device })).data.session as { token: string; deviceId?: string };
    const token = signed.token;
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204);
    const mac = ((await ok(d, token, "devices.mine", {})).devices as Array<{ id: string; class: string; current?: boolean }>).find((x) => x.class === "desktop");
    assert.ok(mac, "the desktop device the person signed in from");

    // a Claude account the Space may use, as the person connects one
    const folder = await ok(d, token, "vault.folders.create", { name: "Accounts", scope: "mine" });
    const flow = await ok(d, token, "providers.subscription_start", { providerKey: "claude-code" });
    await ok(d, token, "vault.item.put", { folderId: folder.folder.id, name: "Dana_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] });
    const provider = await ok(d, token, "providers.subscription_complete", { flowId: flow.flowId });
    await ok(d, token, "providers.set_space_use", { providerId: provider.provider.id, allow: true });

    const agent = (await ok(d, token, "agents.create", { name: "Test", role: "You help Dana." })).agent.agentId as string;
    const threadId = (await ok(d, token, "chat.start", { kind: "chat", agentIds: [agent] })).thread.threadId as string;
    await ok(d, token, "threads.set_mode", { threadId, mode: "auto" });
    await ok(d, token, "chat.post", { threadId, body: `TOOL terminal_run ${JSON.stringify({ command: "echo hi", idempotencyKey: "ap-echo" })}`, mentions: [{ kind: "agent", id: agent }] });

    const said = await waitFor(async () => {
      await d.hooks?.pump?.();
      const m = ((await call(d, token, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined) ?? [];
      return m.find((x) => x.author?.kind === "agent" && /TOOL RESULT/.test(x.body ?? ""))?.body ?? null;
    });
    assert.match(said, /TOOL RESULT ok/, said);
    const result = JSON.parse(said.replace(/^[\s\S]*?TOOL RESULT ok /, "")) as { data: { terminalId: string; exitCode: number; output: string } };
    assert.equal(result.data.exitCode, 0);
    assert.equal(result.data.output, "hi");

    // the agent's own session on this computer, which the person sees and can open
    const mine = (await ok(d, token, "terminal.list", { section: "personal" })).terminals as Array<{ terminalId: string; host: string; hostTitle: string; deviceId?: string; agentId?: string; name: string }>;
    const s = mine.find((t) => t.terminalId === result.data.terminalId);
    assert.ok(s, JSON.stringify(mine));
    assert.deepEqual([s.host, s.hostTitle, s.deviceId, s.agentId, s.name], ["device", "This computer", mac.id, agent, "agent"]);
    const att = await ok(d, token, "terminal.attach", { terminalId: s.terminalId });
    assert.match(att.replay, /echo hi/);
    assert.match(att.replay, /^hi$/m);
    const health = await ok(d, token, "terminal.health", {});
    if (o.tmux) assert.match(String(health.detail), /tmux/);
    else assert.match(String(health.detail), /Install tmux for full terminals/);
    await ok(d, token, "terminal.close", { terminalId: s.terminalId });
  } finally {
    process.env["PATH"] = savedPath;
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
}

test("Personal, this computer, tmux: an agent's terminal_run with no host runs `echo hi` here and the command is in its session under Terminals", async () => {
  await agentRunsHere({ tmux: true });
});

test("Personal, this computer, no tmux (a Mac as shipped): the same command runs in a plain shell and shows in the same kind of session", async () => {
  await agentRunsHere({ tmux: false });
});
