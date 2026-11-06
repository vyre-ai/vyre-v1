// Vyre for Chrome acts as the person signed in to the Vyre app on this computer, never as the owner (lib/chrome-app.ts, routes/team-links.ts): a booted daemon is handed two people's own
// sessions the way the desktop shell hands them over, and the bridge acts as whichever Space is picked in the extension, through the Space's gateway, with that person's access.
// A member's extension cannot use the owner's powers; signing out takes the Space away; with nobody signed in every call is refused.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { startDaemon } from "../host/src/daemon/daemon.ts";
import { issueSessionToken } from "../host/src/daemon/session.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

/** This repo with the devices module live (device sessions are its rows), as revoke.e2e.test.ts builds it. */
function codeRootWithDevicesLive(): string {
  const repo = fileURLToPath(new URL("..", import.meta.url));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chrome-person-"));
  for (const name of fs.readdirSync(repo)) if (name !== ".git" && name !== "host") fs.symlinkSync(path.join(repo, name), path.join(root, name));
  fs.mkdirSync(path.join(root, "host"));
  for (const name of fs.readdirSync(path.join(repo, "host"))) if (name !== "modules.json") fs.symlinkSync(path.join(repo, "host", name), path.join(root, "host", name));
  const list = JSON.parse(fs.readFileSync(path.join(repo, "host/modules.json"), "utf8")) as { modules: { id: string; status: string }[] };
  const dev = list.modules.find((m) => m.id === "devices");
  assert.ok(dev);
  dev.status = "live";
  fs.writeFileSync(path.join(root, "host/modules.json"), JSON.stringify(list));
  return root;
}

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chrome-person-data-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

import { findChromium, launch, site } from "../apps/chrome/tests/e2e/rig.ts";
import { bindPersonalChrome } from "../lib/personal-chrome.ts";
import { harness } from "../modules/computers/fixtures/harness.ts";
import { tool } from "../modules/computers/tests/tools.fixture.ts";
import { handlers as browser } from "../modules/browser/impl.ts";
import { world as browserWorld } from "../modules/browser/fixtures/world.ts";

const found = await findChromium();
const MAIL = `<!doctype html><meta charset="utf-8"><title>Mail</title><main><form method="post" action="/send"><label for="to">To</label><input id="to" name="to" value="dana@client.test">
<label for="subject">Subject</label><input id="subject" name="subject" value="Your signed deed"><label for="body">Message</label><textarea id="body" name="body">Hi Dana, the deed is attached.</textarea><button type="submit">Send</button></form></main>`;

test("the booted daemon, the real extension and a scripted chat turn: the person opens Chrome to agents, the held send is a card in the chat, Send sends once, Don't send is declined", { skip: !found && "no Chromium on this machine", timeout: 120_000 }, async () => {
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: codeRootWithDevicesLive(),
    platform: fakePlatform({ os: "linux", hostname: "chrome-chat", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\n" } } }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000, hooks: 3_600_000 },
  });
  const srv = await site({ "/": MAIL, "/send": () => "<!doctype html><title>Sent</title><p>Sent</p>" });
  const r = await launch(found!, { agent: true, daemon: { url: d.url, token: d.token } });
  try {
    const now = Date.now();
    d.db!.run(`INSERT INTO devices_device (id, person, name, class, epoch, lastSeenAt, location, revokedAt, version, updated_at, deleted_at) VALUES (?, ?, ?, 'desktop', 0, ?, NULL, NULL, 0, ?, NULL)`, "dev_olivia", "usr_olivia", "Olivia Mac", now, now);
    d.db!.run(`INSERT INTO devices_session (id, person, kind, principal_kind, device_id, started_at, last_seen_at, location, revoked_at) VALUES (?, ?, 'device', 'person', ?, ?, ?, NULL, NULL)`, "ses_olivia1", "usr_olivia", "dev_olivia", now, now);
    d.db!.run(`INSERT OR IGNORE INTO identity_accounts (person_id, username, name, verifier, created_at) VALUES (?, ?, ?, ?, ?)`, "usr_olivia", "olivia", "Olivia Park", "x", now);
    const token = issueSessionToken(d.db!, "ses_olivia1");
    const auth = { "content-type": "application/json", authorization: `Bearer ${d.token}` };
    const rpc = async (body: unknown) => (await fetch(`${d.url}/chrome-bridge/v1/rpc`, { method: "POST", headers: auth, body: JSON.stringify({ id: "r", ...(body as object) }) })).json() as Promise<any>;
    assert.equal((await fetch(`${d.url}/local/chrome/spaces`, { method: "POST", headers: auth, body: JSON.stringify({ id: "spc_owner", name: "Member", address: d.url, token }) })).status, 204);
    const whoReply = await rpc({ type: "bridge", op: "whoami", input: {} });
    assert.ok(whoReply.ok, JSON.stringify(whoReply));
    const who = whoReply.output as { person: string; spaceId: string };
    assert.equal(who.person, "usr_olivia");

    // the person gives Scout Act on this site, through the Space's own Browser connections (the real module behind the real gateway)
    const set = await fetch(`${d.url}/v1/browser/sites/set`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ host: "127.0.0.1", runsIn: "chrome", rights: [{ agentId: "agt_scout", right: "act" }], idempotencyKey: "site1" }) });
    assert.equal(set.status, 200, await set.clone().text());

    // closed until the person opens it: the Chrome is not a place agents can work
    const turn = harness({ principal: { kind: "agent", id: "agt_scout" }, actingFor: who.person, respond: {} });
    turn.ctx.space = who.spaceId;
    turn.ctx.thread = "thr_lab7";
    const bw = browserWorld(who.spaceId);
    (turn.respond as Record<string, (i: Record<string, unknown>) => unknown>)["chat.messages.list"] = () => ({ messages: [{ threadSeq: 1, author: { kind: "person", id: who.person }, body: "Please do it in my Chrome" }], hasMore: false });
    (turn.respond as Record<string, (i: Record<string, unknown>) => unknown>)["browser.cards.post"] = (input) => browser["browser.cards.post"](bw.as("agt_scout", "agent"), input as never);
    const agent = (cap: string, input: Record<string, unknown> = {}) => tool[cap]!(turn.ctx, { computerId: "my-chrome", ...input });
    await assert.rejects(agent("computers.chrome.snapshot"), (e: any) => e?.error?.code === "provider.unavailable", "not open to agents yet");

    await r.worker.evaluate((s: string) => (globalThis as any).chrome.storage.local.set({ activeSpace: s }), who.spaceId);
    const page = await r.context.newPage();
    await page.goto(srv.url + "/");
    const tabId = await r.worker.evaluate(async (u: string) => ((await (globalThis as any).chrome.tabs.query({})).find((t: any) => String(t.url).startsWith(u)) ?? {}).id, srv.url);
    assert.equal((await fetch(`${d.url}/local/chrome/agents`, { method: "POST", headers: auth, body: JSON.stringify({ spaces: [who.spaceId] }) })).status, 200);
    await new Promise((x) => { const t = setInterval(() => { if (d.chromeBridge.connected === 1) { clearInterval(t); x(null); } }, 50); });
    await new Promise((x) => setTimeout(x, 400));

    await agent("computers.chrome.tabs", { action: "use", tabId: String(tabId) });
    const snap = await agent("computers.chrome.snapshot");
    const held = await agent("computers.chrome.act", { ref: /button "Send" \[ref=(e\d+)\]/.exec(snap.tree)![1], action: "click" });
    assert.match(held.heldId, /^hld_/);
    const card = bw.called("chat.post").map((c) => c.input as { threadId: string; body: string; mentions: unknown[]; blocks: Array<{ type: string; data: Record<string, any> }> }).find((p) => p.blocks[0]!.type === "chrome_held");
    assert.ok(card, "the held card is in the chat");
    assert.deepEqual([card!.threadId, card!.body, card!.mentions, card!.blocks[0]!.data["card"].subject], ["thr_lab7", "", [], "Your signed deed"]);
    const sends = () => srv.hits.filter((h) => h.path === "/send").length;
    assert.equal(sends(), 0);
    const press = (id: string, key: string, action: "send" | "drop" = "send") => browser["browser.chrome.act"](bw.as(who.person), { action, agentId: "agt_scout", heldId: id, threadId: "thr_lab7", idempotencyKey: key });
    assert.deepEqual(await press(held.heldId, "s1"), { done: true });
    for (let i = 0; i < 100 && sends() < 1; i++) await new Promise((x) => setTimeout(x, 50));
    assert.equal(sends(), 1);
    assert.deepEqual(await press(held.heldId, "s2"), { done: false, already: true });

    await page.goto(srv.url + "/");
    const snap2 = await agent("computers.chrome.snapshot");
    const held2 = await agent("computers.chrome.act", { ref: /button "Send" \[ref=(e\d+)\]/.exec(snap2.tree)![1], action: "click" });
    await press(held2.heldId, "d1", "drop");
    assert.ok(bw.called("chat.post").some((c) => /Don't send that/.test(String((c.input as { body: string }).body))), "the agent hears it was declined");
    await assert.rejects(agent("computers.chrome.send", { heldId: held2.heldId }));
    await new Promise((x) => setTimeout(x, 300));
    assert.equal(sends(), 1, "nothing more went out");

    // closing Chrome to agents ends it
    assert.equal((await fetch(`${d.url}/local/chrome/agents`, { method: "DELETE", headers: auth })).status, 200);
    await new Promise((x) => setTimeout(x, 300));
    await assert.rejects(agent("computers.chrome.snapshot"), (e: any) => e?.error?.code === "provider.unavailable");
  } finally { bindPersonalChrome(null); await r.close(); await srv.close(); await d.stop(); }
});
