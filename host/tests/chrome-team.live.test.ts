// Team Space placement (lane l-chrome2a): a turn on the Space server for a member drives the extension on that member's own computer, over their device link. Two booted daemons (the Space and the member's
// computer), the real extension in headless Chromium on the computer's bridge, and a scripted server-side turn (the computers module's chrome tools, in a thread, for the person it works for).
// Another person's turn can never reach this Chrome; the Chrome is closed to agents until the person opens it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fileExportsImporter } from "../src/loader.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, f: () => Promise<T | undefined | false> | T | undefined | false, ms = 10_000): Promise<T> {
  const t0 = Date.now();
  for (;;) { const v = await f(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await wait(40); }
}

type Reply = { status: number; json: { data?: any; error?: { code: string; message: string } } };   // eslint-disable-line @typescript-eslint/no-explicit-any
const post = async (d: Daemon, p: string, body: unknown, token?: string): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Reply["json"] };
};

async function boot(): Promise<{ d: Daemon; owner: string; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-stream-space-"));
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_stream", "--space-name", "Stream Co", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({ os: "linux", hostname: "stream-space", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch, computeStreamRecheckMs: 300,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
  const device = { deviceName: "Mac", deviceClass: "desktop" };
  assert.equal((await post(d, "/v1/identity/claim_owner", { code, spaceId: "spc_stream", username: "olivia", displayName: "Olivia", password: PASSWORD, ...device, keys: KEYS })).status, 200);
  const signedIn = await post(d, "/v1/identity/sign_in", { username: "olivia", password: PASSWORD, ...device });
  assert.equal(signedIn.status, 200);
  return { d, owner: signedIn.json.data.session.token as string, dir };
}

import { findChromium, launch, site } from "../../apps/chrome/tests/e2e/rig.ts";
import { bindPersonalChrome } from "../../lib/personal-chrome.ts";
import { harness } from "../../modules/computers/fixtures/harness.ts";
import { tool } from "../../modules/computers/tests/tools.fixture.ts";
import { handlers as browser } from "../../modules/browser/impl.ts";
import { world as browserWorld } from "../../modules/browser/fixtures/world.ts";

const found = await findChromium();
const MAIL = `<!doctype html><meta charset="utf-8"><title>Mail</title><main><form method="post" action="/send"><label for="to">To</label><input id="to" name="to" value="dana@client.test">
<label for="subject">Subject</label><input id="subject" name="subject" value="Your signed deed"><label for="body">Message</label><textarea id="body" name="body">Hi Dana, the deed is attached.</textarea><button type="submit">Send</button></form></main>`;

test("a server-side turn for a member drives the extension on the member's own computer over the device link, and nobody else's turn can", { skip: !found && "no Chromium on this machine", timeout: 150_000 }, async () => {
  const space = await boot();
  const dirDevice = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chrome-device-"));
  const device = await startDaemon({
    config: loadConfig(["--role", "device", "--data-dir", dirDevice, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({ os: "linux", hostname: "olivia-mac", free: 80e9, commands: {} }),
    fetch: caddyFetch,
    deviceLink: { launcher: { spawn: async () => { throw new Error("no engine in this test"); } }, engines: [], name: "Olivia's Mac" },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, hooks: 3_600_000 },
  });
  const srv = await site({ "/": MAIL, "/send": () => "<!doctype html><title>Sent</title><p>Sent</p>" });
  const r = await launch(found!, { agent: true, daemon: { url: device.url, token: device.token } });
  const dauth = { "content-type": "application/json", authorization: `Bearer ${device.token}` };
  try {
    const me = await post(space.d, "/v1/identity/whoami", {}, space.owner);
    const person = String(me.json.data?.principal?.id ?? "");
    assert.match(person, /^usr_/, JSON.stringify(me.json));
    // the person signs in to the Space on their own computer: the link to the Space opens
    assert.equal((await fetch(`${device.url}/local/chrome/spaces`, { method: "POST", headers: dauth, body: JSON.stringify({ id: "spc_stream", name: "Stream Co", address: space.d.url, token: space.owner }) })).status, 204);
    await until("the computer's link to the Space", () => space.d.nodeRelay.devices(person).length > 0);

    // the person lets Scout act on this site, through the Space's own Browser connections
    const set = await post(space.d, "/v1/browser/sites/set", { host: "127.0.0.1", runsIn: "chrome", rights: [{ agentId: "agt_scout", right: "act" }], idempotencyKey: "site1" }, space.owner);
    assert.equal(set.status, 200, JSON.stringify(set.json));

    // the scripted server-side turn, for the person, in a chat; the Space's own port (its extension first, then the person's computer)
    bindPersonalChrome(space.d.personalChrome);
    const turnFor = (who: string) => {
      const bw = browserWorld("spc_stream");
      const h = harness({ principal: { kind: "agent", id: "agt_scout" }, actingFor: who, respond: { "browser.cards.post": (i) => browser["browser.cards.post"](bw.as("agt_scout", "agent"), i as never) } });
      h.ctx.space = "spc_stream";
      h.ctx.thread = "thr_lab7";
      return { h, bw, agent: (cap: string, input: Record<string, unknown> = {}) => tool[cap]!(h.ctx, { computerId: "my-chrome", ...input }) };
    };
    const mine = turnFor(person);
    const theirs = turnFor("usr_someone_else");

    // closed until the person opens Chrome to agents on their computer
    await assert.rejects(mine.agent("computers.chrome.snapshot"), (e: any) => e?.error?.code === "provider.unavailable");
    await r.worker.evaluate((s: string) => (globalThis as any).chrome.storage.local.set({ activeSpace: s }), "spc_stream");
    const page = await r.context.newPage();
    await page.goto(srv.url + "/");
    const tabId = await r.worker.evaluate(async (u: string) => ((await (globalThis as any).chrome.tabs.query({})).find((t: any) => String(t.url).startsWith(u)) ?? {}).id, srv.url);
    assert.equal((await fetch(`${device.url}/local/chrome/agents`, { method: "POST", headers: dauth, body: JSON.stringify({ spaces: ["spc_stream"] }) })).status, 200);
    await until("the extension's agent channel", () => device.chromeBridge.connected === 1);
    await wait(500);

    // the person's own turn works the page on their computer, and the held card lands in the chat on the server
    await mine.agent("computers.chrome.tabs", { action: "use", tabId: String(tabId) });
    const snap = await mine.agent("computers.chrome.snapshot");
    assert.match(snap.tree, /button "Send"/, "the page on the member's computer, read from the server");
    const held = await mine.agent("computers.chrome.act", { ref: /button "Send" \[ref=(e\d+)\]/.exec(snap.tree)![1], action: "click" });
    assert.match(held.heldId, /^hld_/);
    const card = mine.bw.called("chat.post").map((c) => c.input as { threadId: string; blocks: Array<{ type: string; data: Record<string, any> }> }).find((p) => p.blocks[0]!.type === "chrome_held");
    assert.ok(card, "the held card was left in the chat");
    assert.equal(card!.blocks[0]!.data["card"].subject, "Your signed deed");
    const sends = () => srv.hits.filter((h) => h.path === "/send").length;
    assert.equal(sends(), 0);
    // Send on the card, from the server, with an edit: sent once, as edited
    const press = (id: string, key: string, extra: Record<string, unknown> = {}) => browser["browser.chrome.act"](mine.bw.as(person), { action: "send", agentId: "agt_scout", heldId: id, threadId: "thr_lab7", idempotencyKey: key, ...extra } as never);
    assert.deepEqual(await press(held.heldId, "s1", { edits: { subject: "Edited on the server" } }), { done: true });
    await until("the send", () => sends() === 1);
    assert.match(decodeURIComponent(srv.hits.filter((h) => h.path === "/send")[0]!.body.replace(/\+/g, " ")), /subject=Edited on the server/);
    assert.deepEqual(await press(held.heldId, "s2"), { done: false, already: true });

    // another person's turn cannot reach this Chrome, with the same words as a closed one
    await assert.rejects(theirs.agent("computers.chrome.snapshot"), (e: any) => e?.error?.code === "provider.unavailable");
    await assert.rejects(theirs.agent("computers.chrome.act", { ref: "e1", action: "click" }), (e: any) => e?.error?.code === "provider.unavailable");
    assert.equal(sends(), 1, "and nothing of theirs reached the page");
  } finally {
    bindPersonalChrome(null);
    await r.close(); await srv.close();
    await device.stop(); await space.d.stop();
  }
});
