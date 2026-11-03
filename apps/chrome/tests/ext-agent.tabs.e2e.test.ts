// Agents in the person's own Chrome, in a real headless Chromium with the unpacked extension (Chrome step 2, part A): an agent drives a tab the person handed it, the tab joins the group
// "Vyre · Scout", a send is held (the bar says Waiting for you in Vyre, the card's To, From, Subject and Message reach the app), chrome_send presses it once, Take over and Stop and Esc
// each give the tab back, and the agent waits until chrome_resume. The extension is loaded from a copy that holds the debugger permission (e2e/rig.ts), since a test cannot answer Chrome's prompt.
import test from "node:test";
import assert from "node:assert/strict";
import { findChromium, launch, site } from "./e2e/rig.ts";
import { boxOf } from "./e2e/pierce.ts";

const found = await findChromium();
const SECRET = "Tr0ub4dor&3-sentinel";
const site1 = (host: string) => ({ id: "bsi_1", host, runsIn: "chrome", rights: [{ agentId: "agt_scout", right: "act" }, { agentId: "agt_intake", right: "read" }], at: 1, updatedAt: 1 });

const LOGIN = `<!doctype html><meta charset="utf-8"><title>Acme sign in</title><main><form method="post" action="/dashboard"><label>Email <input id="em" name="email" type="email" autocomplete="username"></label>
<label>Password <input id="pw" name="password" type="password" autocomplete="current-password"></label><button type="submit">Sign in</button></form></main>`;
const MAIL = `<!doctype html><meta charset="utf-8"><title>Mail · Compose</title>
<style>body{font:15px system-ui,sans-serif;margin:0;background:#F5F7FB;color:#1d2433}header{height:52px;background:#fff;border-bottom:1px solid #E4E8F0;display:flex;align-items:center;padding:0 18px;font-weight:600}
main{max-width:620px;margin:28px auto;background:#fff;border:1px solid #E4E8F0;border-radius:10px;padding:20px}label{display:block;font-size:12px;color:#6B778C;margin:10px 0 4px}
input,select,textarea{width:100%;box-sizing:border-box;font:inherit;border:1px solid #D5DBE6;border-radius:6px;padding:7px 10px}textarea{height:110px}button{margin-top:14px;font:inherit;padding:8px 18px;border:0;border-radius:8px;background:#2f5d50;color:#fff}</style>
<header>Mail</header><main><form method="post" action="/send"><label for="from">From</label><select id="from" name="from"><option>olivia@firm.test</option></select>
<label for="to">To</label><input id="to" name="to" value="dana@client.test"><label for="subject">Subject</label><input id="subject" name="subject" value="Your signed deed">
<label for="body">Message</label><textarea id="body" name="body">Hi Dana, the signed deed is attached. Call me with questions.</textarea><button type="submit">Send</button></form></main>`;

/** Where a button inside the agent's closed shadow root is on the page. */
const buttonBox = (page: any, label: string) => boxOf(page, "button", label);

test("an agent in the person's Chrome: tab group, held send with its card, Take over, Stop and Esc", { skip: !found && "no Chromium on this machine", timeout: 90_000 }, async () => {
  const srv = await site({ "/login": LOGIN, "/": MAIL, "/send": () => "<!doctype html><title>Sent</title><p>Sent</p>" });
  let push: (m: Record<string, unknown>) => void = () => {};
  const r = await launch(found!, {
    agent: true,
    caps: {
      "browser.sites.list": () => ({ sites: [site1("127.0.0.1")] }),
      "vault.fill": (input) => { push({ type: "fill", ref: (input["target"] as any).ref, value: SECRET }); return { filled: true, field: "password", where: "browser" }; },
    },
  });
  push = (m) => r.bridge.push(m);
  const agent = { id: "agt_scout", name: "Scout" };
  const call = (tool: string, input: Record<string, unknown> = {}) => r.bridge.callTool({ tool, input, agent, space: "spc_mla" }) as Promise<any>;
  const eventsOf = (name: string) => r.events.filter((e) => e["event"] === name);
  try {
    await r.worker.evaluate(() => (globalThis as any).chrome.storage.local.set({ activeSpace: "spc_mla" }));
    const page = await r.context.newPage();
    await page.goto(srv.url + "/");
    const tabId = await r.worker.evaluate(async (u: string) => ((await (globalThis as any).chrome.tabs.query({})).find((t: any) => String(t.url).startsWith(u)) ?? {}).id, srv.url);
    await r.waitFor(() => r.bridge.connected === 1, 15_000, "the extension's agent channel");
    r.bridge.optIn(["spc_mla"], "personal");
    await r.waitFor(() => r.callsTo("hello").length >= 0 && true);
    await new Promise((x) => setTimeout(x, 300));

    // the person's tab is handed to the agent; it joins the agent's group, named and coloured
    await call("chrome_tabs", { action: "use", tabId: String(tabId) });
    const snap = await call("chrome_snapshot");
    const groups = await r.worker.evaluate(async () => (await (globalThis as any).chrome.tabGroups.query({})).map((g: any) => ({ title: g.title, color: g.color })));
    assert.equal(groups.length, 1);
    assert.equal(groups[0].title, "Vyre · Scout");
    assert.notEqual(groups[0].color, "grey");
    const tab = await r.worker.evaluate(async (id: number) => (globalThis as any).chrome.tabs.get(id), tabId);
    assert.ok(tab.groupId > 0, "the tab is in the group");
    await r.shot(page, "chrome2a-agent-working");

    // Read only: another agent may read this site and is refused an act, in words that say where to change it
    const intake = { id: "agt_intake", name: "Intake" };
    const asIntake = (tool: string, input: Record<string, unknown> = {}) => r.bridge.callTool({ tool, input, agent: intake, space: "spc_mla" }) as Promise<any>;
    const page2 = await r.context.newPage();
    await page2.goto(srv.url + "/");
    const tab2 = await r.worker.evaluate(async (u: string) => (await (globalThis as any).chrome.tabs.query({ active: true })).map((t: any) => t.id).pop(), srv.url);
    await asIntake("chrome_tabs", { action: "use", tabId: String(tab2) });
    assert.match((await asIntake("chrome_snapshot")).tree, /Subject/, "reading is allowed");
    await assert.rejects(asIntake("chrome_type", { ref: "e1", text: "x" }), (e: any) => e.code === "read_only" && /Vault, Connections, Browser/.test(e.message));
    await asIntake("chrome_stop");
    await page2.close();
    await page.bringToFront();
    await call("chrome_snapshot");

    // the send is held: the bar changes, and the card's fields reach the app in the held event
    const send = /button "Send" \[ref=(e\d+)\]/.exec(snap.tree)![1];
    const held = await call("chrome_act", { ref: send, action: "click" });
    assert.match(held.heldId, /^hld_/);
    const ev = await r.waitFor(() => eventsOf("held")[0], 5000, "the held event");
    assert.equal(ev["name"], "Scout");
    assert.deepEqual({ to: ev["card"].to, from: ev["card"].from, subject: ev["card"].subject, message: ev["card"].message },
      { to: "dana@client.test", from: "olivia@firm.test", subject: "Your signed deed", message: "Hi Dana, the signed deed is attached. Call me with questions." });
    await new Promise((x) => setTimeout(x, 300));
    await r.shot(page, "chrome2a-agent-waiting");
    assert.equal(srv.hits.filter((h) => h.path === "/send").length, 0, "nothing was sent");
    const sent = await call("chrome_send", { heldId: held.heldId });
    assert.equal(sent.sent, true);
    await r.waitFor(() => srv.hits.filter((h) => h.path === "/send").length === 1, 5000, "the send");

    // Vault fill: the value goes from the Vault, through the extension, into the page; the agent and the app's event log never see it
    await page.goto(srv.url + "/login");
    const login = await call("chrome_snapshot");
    const pw = /textbox "Password" \[ref=(e\d+)\]/.exec(login.tree)![1];
    const filled = await call("chrome_fill", { fields: [{ ref: pw, value: "#Acme_Portal.password" }] });
    assert.equal(await page.inputValue("#pw"), SECRET, "the value reached the page");
    const after = await call("chrome_snapshot");
    assert.ok(!JSON.stringify([filled, after, r.events, login]).includes(SECRET), "the agent, its events and the log never held the value");
    assert.match(after.tree, /value=•+/);
    await page.goto(srv.url + "/");
    await call("chrome_snapshot");

    // Take over: the bar's button gives the tab back; the agent is told to wait; the tab stays in its group
    await page.goto(srv.url + "/");
    await call("chrome_snapshot");
    const take = await buttonBox(page, "Take over");
    await page.mouse.click(take.x, take.y);
    await r.waitFor(() => eventsOf("takeover")[0], 5000, "the takeover event");
    await assert.rejects(call("chrome_snapshot"), (e: any) => e.code === "paused");
    assert.equal((await call("chrome_status")).pausedBy, "takeover");
    assert.ok((await r.worker.evaluate(async (id: number) => (globalThis as any).chrome.tabs.get(id), tabId)).groupId > 0, "still grouped");
    await call("chrome_resume");

    // Stop
    await call("chrome_snapshot");
    const stop = await buttonBox(page, "Stop");
    await page.mouse.click(stop.x, stop.y);
    await r.waitFor(() => eventsOf("stopped").some((e) => e["by"] === "person"), 5000, "stopped by the person");
    await assert.rejects(call("chrome_snapshot"), (e: any) => e.code === "paused");
    await call("chrome_resume");

    // Esc
    await call("chrome_snapshot");
    await page.keyboard.press("Escape");
    await r.waitFor(() => eventsOf("paused")[0], 5000, "paused by Esc");
    await assert.rejects(call("chrome_snapshot"), (e: any) => e.code === "paused");
  } finally {
    await r.close();
    await srv.close();
  }
});
