// Photographs of the extension (shared by ext-chrome2a.shots.paper.e2e.test.ts and ext-chrome2a.shots.graphite.e2e.test.ts, one skin each so a file stays well under its watchdog)'s own pieces for Chrome step 2 part A, in a real headless Chromium: the agent bar working and waiting, the field badge, the account picker and the Save to Vault card in
// Mine and Shared, at 1440 and 390 wide, in a light and a dark page (paper and graphite). They go to VYRE_SHOT_DIR. Each shot is also an assertion that the piece is on the page.
import assert from "node:assert/strict";
import { findChromium, launch, site } from "./rig.ts";
import { boxOf, press } from "./pierce.ts";

export const found = await findChromium();
const PASSWORD = "Tr0ub4dor&3-sentinel";
const USERNAME = "dana@acme.test";
const SIZES = { wide: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;

const MAIL = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mail · Compose</title>
<style>:root{color-scheme:light dark}body{font:15px system-ui,sans-serif;margin:0;background:#F5F7FB;color:#1d2433}header{height:52px;background:#fff;border-bottom:1px solid #E4E8F0;display:flex;align-items:center;padding:0 18px;font-weight:600}
main{max-width:620px;margin:24px auto;background:#fff;border:1px solid #E4E8F0;border-radius:10px;padding:18px}label{display:block;font-size:12px;color:#6B778C;margin:10px 0 4px}
input,select,textarea{width:100%;box-sizing:border-box;font:inherit;border:1px solid #D5DBE6;border-radius:6px;padding:7px 10px;background:#fff;color:#1d2433}textarea{height:110px}button{margin-top:14px;font:inherit;padding:8px 18px;border:0;border-radius:8px;background:#2f5d50;color:#fff}
@media (prefers-color-scheme:dark){body{background:#17171a;color:#eceae6}header,main{background:#202024;border-color:#34343a}input,select,textarea{background:#2a2a2f;color:#eceae6;border-color:#44444a}label{color:#9a9aa3}}</style>
<header>Mail</header><main><form method="post" action="/send"><label for="from">From</label><select id="from" name="from"><option>olivia@firm.test</option></select>
<label for="to">To</label><input id="to" name="to" value="dana@client.test"><label for="subject">Subject</label><input id="subject" name="subject" value="Your signed deed">
<label for="body">Message</label><textarea id="body" name="body">Hi Dana, the signed deed is attached. Call me with questions.</textarea><button type="submit">Send</button></form></main>`;
const LOGIN = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acme Portal · Sign in</title>
<style>:root{color-scheme:light dark}body{font:15px system-ui,sans-serif;margin:0;background:#F5F7FB;color:#1d2433}main{max-width:380px;margin:64px auto;background:#fff;border:1px solid #E4E8F0;border-radius:12px;padding:26px}
h1{font-size:20px;margin:0 0 16px}label{display:block;font-size:12px;color:#6B778C;margin:12px 0 4px}input{width:100%;box-sizing:border-box;height:38px;border:1px solid #D5DBE6;border-radius:8px;padding:0 12px;font:inherit;background:#fff;color:#1d2433}
button{margin-top:18px;width:100%;height:40px;border:0;border-radius:8px;background:#2f5d50;color:#fff;font:inherit}
@media (prefers-color-scheme:dark){body{background:#17171a;color:#eceae6}main{background:#202024;border-color:#34343a}input{background:#2a2a2f;color:#eceae6;border-color:#44444a}label{color:#9a9aa3}}</style>
<main><h1>Acme Portal</h1><form method="post" action="/dashboard"><label for="em">Email</label><input id="em" name="email" type="email" autocomplete="username">
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form></main>`;
const DASH = `<!doctype html><meta charset="utf-8"><title>Acme Portal</title><body style="font:15px system-ui;background:#F5F7FB;padding:40px"><h1>Signed in</h1>`;

const AGENTS = { agents: [{ id: "agt_intake", name: "Intake" }, { id: "agt_scout", name: "Scout" }], suggested: { id: "agt_intake", name: "Intake" } };


/** Photograph every piece in one skin: a light page is paper, a dark page is graphite. */
export async function shootExtension(scheme: "light" | "dark", skin: "paper" | "graphite"): Promise<void> {
    const srv = await site({ "/": MAIL, "/login": LOGIN, "/dashboard": DASH, "/send": () => "<!doctype html><title>Sent</title><p>Sent</p>" });
    let push: (m: Record<string, unknown>) => void = () => {};
    const r = await launch(found!, {
      agent: true, colorScheme: scheme,
      ops: { "agents.list": () => AGENTS, "login.check": () => ({ state: "new", name: "Acme Portal" }) },
      caps: {
        "browser.sites.list": () => ({ sites: [{ id: "bsi_1", host: "127.0.0.1", runsIn: "chrome", rights: [{ agentId: "agt_scout", right: "act" }], at: 1, updatedAt: 1 }] }),
        "vault.items.match": () => ({ items: [{ item: { id: "vit_acme", name: "Acme Portal", kind: "login", handle: "#Acme_Portal", fieldKeys: ["username", "password"] }, usernameField: "username" }] }),
        "vault.use": (i) => ({ handle: "#Acme_Portal", itemId: i["item"], fields: ["username", "password"] }),
        "vault.fill": (i) => { push({ type: "fill", ref: (i["target"] as any).ref, value: String(i["handle"]).endsWith(".username") ? USERNAME : PASSWORD }); return { filled: true, where: "browser" }; },
        "vault.folders.list": (i) => ({ folders: i["scope"] === "shared" ? [{ id: "vfd_team", name: "Team logins", yourLevel: "edit" }] : [{ id: "vfd_mine", name: "Mine", yourLevel: "manage" }] }),
        "vault.item.put": () => ({ item: { id: "vit_new" } }),
        "vault.share": () => ({ granted: true }),
      },
    });
    push = (m) => r.bridge.push(m);
    const agent = { id: "agt_scout", name: "Scout" };
    const call = (tool: string, input: Record<string, unknown> = {}) => r.bridge.callTool({ tool, input, agent, space: "spc_mla" }) as Promise<any>;
    try {
      await r.worker.evaluate(() => (globalThis as any).chrome.storage.local.set({ activeSpace: "spc_mla" }));
      const page = await r.context.newPage();
      await r.waitFor(() => r.bridge.connected === 1, 15_000, "the agent channel");
      r.bridge.optIn(["spc_mla"], "personal");
      await new Promise((x) => setTimeout(x, 300));
      const name = (piece: string, size: string) => `chrome-${piece}-${skin}-${size}`;
      for (const [size, vp] of Object.entries(SIZES)) {
        await page.setViewportSize(vp);
        // the agent at work, then a send held
        await page.goto(srv.url + "/");
        const tabId = await r.worker.evaluate(async (u: string) => ((await (globalThis as any).chrome.tabs.query({})).find((t: any) => String(t.url).startsWith(u)) ?? {}).id, srv.url);
        await call("chrome_tabs", { action: "use", tabId: String(tabId) });
        const snap = await call("chrome_snapshot");
        await call("chrome_plan", { goal: "Send Dana the signed deed" });
        await new Promise((x) => setTimeout(x, 250));
        await r.shot(page, name("agent-working", size));
        const held = await call("chrome_act", { ref: /button "Send" \[ref=(e\d+)\]/.exec(snap.tree)![1], action: "click" });
        assert.match(held.heldId, /^hld_/);
        await new Promise((x) => setTimeout(x, 300));
        await r.shot(page, name("agent-waiting", size));
        await call("chrome_stop");
        await call("chrome_resume");
        // the badge and the picker
        await page.goto(srv.url + "/login");
        await page.click("#em");
        await boxOf(page, "button", "Sign in with Vyre");
        await r.shot(page, name("badge", size));
        await press(page, "button", "Sign in with Vyre");
        await boxOf(page, "button", "Acme Portal");
        await r.shot(page, name("picker", size));
        // Save to Vault?, Mine then Shared
        await page.goto(srv.url + "/login");
        await page.fill("#em", USERNAME);
        await page.fill("#pw", PASSWORD);
        await page.click("button[type=submit]");
        await boxOf(page, "button", "Shared");
        await new Promise((x) => setTimeout(x, 250));
        await r.shot(page, name("save-mine", size));
        await press(page, "button", "Shared");
        await boxOf(page, "button", "Save");
        await new Promise((x) => setTimeout(x, 500));
        await r.shot(page, name("save-shared", size));
        await press(page, "button", "Not now");
        await new Promise((x) => setTimeout(x, 200));
      }
    } finally { await r.close(); await srv.close(); }
}
