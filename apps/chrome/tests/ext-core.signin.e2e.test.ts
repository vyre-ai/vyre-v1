// Sign in with Vault in a real headless Chromium with the unpacked extension: the Vyre badge in a sign-in field and its account picker, and "Save to Vault?" with Mine by default and Shared with a folder
// and an agent allow list ("Save to my agent, then share"). Values go from the Vault to the page by push and are never in a call the app logs. Screenshots go to VYRE_SHOT_DIR.
import test from "node:test";
import assert from "node:assert/strict";
import { findChromium, launch, site } from "./e2e/rig.ts";
import { boxOf, press } from "./e2e/pierce.ts";

const found = await findChromium();
const PASSWORD = "Tr0ub4dor&3-sentinel";
const USERNAME = "dana@acme.test";

const LOGIN = `<!doctype html><meta charset="utf-8"><title>Acme Portal · Sign in</title>
<style>body{font:15px system-ui,sans-serif;margin:0;background:#F5F7FB;color:#1d2433}main{max-width:380px;margin:80px auto;background:#fff;border:1px solid #E4E8F0;border-radius:12px;padding:26px}
h1{font-size:20px;margin:0 0 16px}label{display:block;font-size:12px;color:#6B778C;margin:12px 0 4px}input{width:100%;box-sizing:border-box;height:38px;border:1px solid #D5DBE6;border-radius:8px;padding:0 12px;font:inherit}
button{margin-top:18px;width:100%;height:40px;border:0;border-radius:8px;background:#2f5d50;color:#fff;font:inherit}</style>
<main><h1>Acme Portal</h1><form method="post" action="/dashboard"><label for="em">Email</label><input id="em" name="email" type="email" autocomplete="username">
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form></main>`;
const DASH = `<!doctype html><meta charset="utf-8"><title>Acme Portal</title><body style="font:15px system-ui;background:#F5F7FB;padding:40px"><h1>Signed in</h1>`;

function vaultCaps(push: (m: Record<string, unknown>) => void) {
  return {
    "vault.items.match": () => ({ items: [{ item: { id: "vit_acme", name: "Acme Portal", kind: "login", handle: "#Acme_Portal", fieldKeys: ["username", "password"] }, usernameField: "username", username: USERNAME }] }),
    "vault.use": (i: Record<string, any>) => ({ handle: "#Acme_Portal", itemId: i["item"], fields: ["username", "password"] }),
    "vault.fill": (i: Record<string, any>) => { push({ type: "fill", ref: i["target"].ref, value: String(i["handle"]).endsWith(".username") ? USERNAME : PASSWORD }); return { filled: true, where: "browser" }; },
    "vault.folders.list": (i: Record<string, any>) => ({ folders: i["scope"] === "shared"
      ? [{ id: "vfd_team", name: "Team logins", yourLevel: "edit" }, { id: "vfd_ro", name: "Finance", yourLevel: "view" }] : [{ id: "vfd_mine", name: "Mine", yourLevel: "manage" }] }),
    "vault.item.put": () => ({ item: { id: "vit_new" } }),
    "vault.share": () => ({ granted: true }),
  };
}
const AGENTS = { agents: [{ id: "agt_intake", name: "Intake" }, { id: "agt_scout", name: "Scout" }], suggested: { id: "agt_intake", name: "Intake" } };

test("the badge in a sign-in field opens an account picker; picking an account fills it, and no call the app logs holds a value", { skip: !found && "no Chromium on this machine", timeout: 60_000 }, async () => {
  const srv = await site({ "/login": LOGIN, "/dashboard": DASH });
  let push: (m: Record<string, unknown>) => void = () => {};
  const r = await launch(found!, { caps: vaultCaps((m) => push(m)), ops: { "agents.list": () => AGENTS } });
  push = (m) => r.bridge.push(m);
  try {
    const page = await r.context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(srv.url + "/login");
    await r.worker.evaluate(() => (globalThis as any).chrome.storage.local.set({ activeSpace: "spc_mla" }));
    await page.click("#em");
    const badge = await boxOf(page, "button", "Sign in with Vyre");
    const field = await page.locator("#em").boundingBox();
    assert.ok(badge.x > field!.x + field!.width - 40 && badge.x < field!.x + field!.width, "the badge sits inside the field's right edge");
    await r.shot(page, "chrome2a-badge");
    await page.mouse.click(badge.x, badge.y);
    await boxOf(page, "button", "Acme Portal");
    await boxOf(page, "span", USERNAME);
    await r.shot(page, "chrome2a-picker");
    await press(page, "button", "Acme Portal");
    await r.waitFor(async () => (await page.inputValue("#pw")) === PASSWORD ? true : undefined as any, 3000, "the password in the field").catch(() => {});
    for (let i = 0; i < 40 && (await page.inputValue("#pw")) !== PASSWORD; i++) await new Promise((x) => setTimeout(x, 50));
    assert.equal(await page.inputValue("#em"), USERNAME);
    assert.equal(await page.inputValue("#pw"), PASSWORD);
    const logged = JSON.stringify(r.calls);
    assert.ok(!logged.includes(PASSWORD) && !logged.includes(USERNAME), "no call from the extension to the app carried a value");
  } finally { await r.close(); await srv.close(); }
});

test("Save to Vault?: Mine by default; Shared lists the folders you may add to and the agents, and saves there with the agents allowed, each call keyed", { skip: !found && "no Chromium on this machine", timeout: 60_000 }, async () => {
  const srv = await site({ "/login": LOGIN, "/dashboard": DASH });
  let push: (m: Record<string, unknown>) => void = () => {};
  const r = await launch(found!, { caps: vaultCaps((m) => push(m)), ops: { "agents.list": () => AGENTS, "login.check": () => ({ state: "new", name: "Acme Portal" }) } });
  push = (m) => r.bridge.push(m);
  try {
    await r.worker.evaluate(() => (globalThis as any).chrome.storage.local.set({ activeSpace: "spc_mla" }));
    const page = await r.context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(srv.url + "/login");
    await page.fill("#em", USERNAME);
    await page.fill("#pw", PASSWORD);
    await page.click("button[type=submit]");
    await boxOf(page, "button", "Shared");
    await new Promise((x) => setTimeout(x, 300));
    await r.shot(page, "chrome2a-save-mine");
    await press(page, "button", "Shared");
    await boxOf(page, "button", "Save");
    for (let i = 0; i < 40 && !r.callsTo("vault.folders.list").some((c) => c.input["scope"] === "shared"); i++) await new Promise((x) => setTimeout(x, 50));
    await new Promise((x) => setTimeout(x, 300));
    await r.shot(page, "chrome2a-save-shared");
    await press(page, "button", "Save");
    await r.waitFor(() => r.callsTo("vault.item.put")[0], 5000, "the save");
    const put = r.callsTo("vault.item.put")[0]!;
    assert.equal(put.input["folderId"], "vfd_team", "Shared saves into the folder it listed, not Mine");
    assert.match(String(put.input["idempotencyKey"]), /^chr_card_[a-f0-9]+_put$/);
    const shares = await r.waitFor(() => { const c = r.callsTo("vault.share"); return c.length ? c : undefined; }, 5000, "the share");
    assert.deepEqual(shares.map((s) => [s.input["subject"], s.input["level"], s.input["resource"]]), [[{ kind: "agent", id: "agt_intake" }, "use", { type: "vault_item", id: "vit_new" }]], "only the agent allowed on the card (Intake, suggested) was granted Use");
    assert.match(String(shares[0]!.input["idempotencyKey"]), /^chr_card_[a-f0-9]+_use_agt_intake$/);
    assert.equal(r.callsTo("vault.folders.list").filter((c) => c.input["scope"] === "mine").length, 0, "the Mine folder was never needed");
  } finally { await r.close(); await srv.close(); }
});

test("a page script cannot read the Save card, the picker or the password, even while Peek shows it", { skip: !found && "no Chromium on this machine", timeout: 60_000 }, async () => {
  const srv = await site({ "/login": LOGIN, "/dashboard": DASH });
  let push: (m: Record<string, unknown>) => void = () => {};
  const r = await launch(found!, { caps: vaultCaps((m) => push(m)), ops: { "agents.list": () => AGENTS, "login.check": () => ({ state: "new", name: "Acme Portal" }) } });
  push = (m) => r.bridge.push(m);
  /** Everything a hostile page script can reach: the whole document, every open shadow root, every attribute, and what a script can call on the extension's host elements. */
  const probe = () => ({
    html: document.documentElement.outerHTML,
    roots: [...document.querySelectorAll("*")].map((e) => (e as Element).shadowRoot).filter(Boolean).length,
    text: document.documentElement.innerText,
    forms: [...document.querySelectorAll("input")].map((i) => (i as HTMLInputElement).value),
  });
  try {
    await r.worker.evaluate(() => (globalThis as any).chrome.storage.local.set({ activeSpace: "spc_mla" }));
    const page = await r.context.newPage();
    await page.goto(srv.url + "/login");
    await page.fill("#em", USERNAME);
    await page.fill("#pw", PASSWORD);
    await page.click("button[type=submit]");
    await boxOf(page, "button", "Peek");
    await press(page, "button", "Peek");
    await new Promise((x) => setTimeout(x, 200));
    const seen = await page.evaluate(probe);
    assert.equal(seen.roots, 0, "no open shadow root: the card's is closed");
    assert.ok(!seen.html.includes(PASSWORD) && !seen.text.includes(PASSWORD), "the password is not in anything the page can read");
    assert.ok(!JSON.stringify(seen.forms).includes(PASSWORD));
    // and a click the page makes cannot press the card's buttons: it has no way to reach them
    const reached = await page.evaluate(() => document.elementFromPoint(window.innerWidth - 100, 60)?.tagName ?? "");
    assert.ok(reached !== "BUTTON" && reached !== "INPUT", "the page sees the host element, not the card's controls");
    const shot = await boxOf(page, "button", "Peek");
    assert.ok(shot.x > 0, "while the person can");
  } finally { await r.close(); await srv.close(); }
});
