// The side panel in a real headless Chromium with the unpacked extension, its native host and the daemon's bridge (tests/e2e/rig.ts): the panel opens with the page and a masked
// screenshot attached, a selection becomes a Selected chip and the bubble's Save to Notes clips it, a reply streams in, and incognito is off. Screenshots go to VYRE_SHOT_DIR.
// The panel page is opened as its own window for the tab's window (?window=), which is how a test can drive it; Chrome's own side panel loads the same page.
import test from "node:test";
import assert from "node:assert/strict";
import { EXT_ID, findChromium, launch, site } from "./e2e/rig.ts";

const found = await findChromium();

const CONTACT = `<!doctype html><meta charset="utf-8"><title>Marisol Vega · Contacts</title>
<style>body{font:15px system-ui,sans-serif;margin:0;background:#F5F7FB;color:#1d2433}header{height:52px;background:#fff;border-bottom:1px solid #E4E8F0;display:flex;align-items:center;padding:0 18px;font-weight:600}
main{padding:24px;display:grid;grid-template-columns:320px 1fr;gap:20px}.card{background:#fff;border:1px solid #E4E8F0;border-radius:10px;padding:18px}label{display:block;font-size:12px;color:#6B778C;margin:12px 0 4px}
input{width:100%;box-sizing:border-box;height:34px;border:1px solid #D5DBE6;border-radius:6px;padding:0 10px;font:inherit}</style>
<header>GoHighLevel · Contacts</header><main><div class="card"><h2>Marisol Vega</h2><p>Vega Family Law · Phoenix</p><p>marisol@vegalaw.com</p>
<label>Portal password</label><input id="pw" type="password" value="hunter2-Pa55"></div>
<div class="card"><h3>Notes</h3><p id="quote">She said her firm loses every lead that comes in after 5 PM, and she wants answers in five minutes.</p><p>Booked a Grow Track Plus discovery call for Thursday at 2:00 PM MST.</p></div></main>`;

async function openPanelFor(r: any, pageUrlPrefix: string) {
  const winId = await r.worker.evaluate(async (prefix: string) => {
    const c = (globalThis as any).chrome;
    const [t] = await c.tabs.query({});
    const tabs = await c.tabs.query({});
    const tab = tabs.find((x: any) => String(x.url).startsWith(prefix)) ?? t;
    return tab.windowId;
  }, pageUrlPrefix);
  const waiting = r.context.waitForEvent("page", { predicate: (p: any) => p.url().includes("/src/panel/panel.html") });
  await r.worker.evaluate(async (w: number) => { await (globalThis as any).chrome.windows.create({ url: `src/panel/panel.html?window=${w}`, type: "popup", width: 400, height: 760, focused: false }); }, winId);
  const panel = await waiting;
  if (process.env["VYRE_E2E_DEBUG"]) { panel.on("console", (m: any) => console.log("panel:", m.text())); panel.on("pageerror", (e: any) => console.log("panel error:", String(e))); r.worker.on("console", (m: any) => console.log("worker:", m.text())); }
  await panel.setViewportSize({ width: 400, height: 760 });
  return panel;
}

test("the side panel opens on the page with its masked screenshot, a selection becomes the Selected chip, a reply streams in, and Save to Notes clips the selection", { skip: !found, timeout: 30_000 }, async () => {
  const s = await site({ "/contacts/c_8812": CONTACT });
  const r = await launch(found!, {
    ops: {
      "agents.list": () => ({ agents: [{ id: "agt_assist", name: "Assistant", assistant: true }, { id: "agt_scout", name: "Scout", role: "Sales follow-up" }], suggested: { id: "agt_assist", name: "Assistant" } }),
      "records.match": () => ({ records: [{ id: "rec_1", name: "Marisol Vega", kind: "Contact", why: "by email address", chats: [{ threadId: "thr_7", title: "Follow up after Lab 7", agentName: "Scout", at: Date.now() - 2 * 86400_000 }], goals: [{ goalId: "gol_1", title: "Close 12 GT+ seats in November", progress: 0.58, label: "7 of 12" }] }] }),
      "chat.ask": () => ({ threadId: "thr_1", turnId: "msg_1" }),
    },
    caps: {
      "engine.models.list": () => ({ models: [{ provider: "anthropic", model: "claude-opus-5-5", title: "Opus 5.5", driver: "api", allowed: true, isDefault: true }, { provider: "anthropic", model: "claude-sonnet-5-5", title: "Sonnet 5.5", driver: "api", allowed: true }] }),
      "notes.clip": () => ({ note: { noteId: "not_1" } }),
    },
  });
  try {
    const page = await r.context.newPage();
    await page.goto(`${s.url}/contacts/c_8812`);
    await page.bringToFront();
    const panel = await openPanelFor(r, s.url);
    // the page chip: title and a screenshot
    await panel.waitForSelector(".ch.pg .shot img", { timeout: 8000 });
    assert.equal(await panel.textContent(".ch.pg .t"), "Marisol Vega · Contacts");
    await panel.waitForSelector(".recl");
    assert.match(await panel.textContent(".recl") ?? "", /Marisol Vega · Contact/);
    // the password field is a black box in the screenshot that leaves Chrome
    const shot = await panel.getAttribute(".ch.pg .shot img", "src");
    const box = await page.evaluate(() => { const b = document.getElementById("pw")!.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, vw: innerWidth, vh: innerHeight }; });
    const px = await panel.evaluate(async ({ src, box }: any) => {
      const img = new Image(); img.src = src; await img.decode();
      const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
      const d = g.getImageData(Math.round(box.x * img.width / box.vw), Math.round(box.y * img.height / box.vh), 1, 1).data; return [d[0], d[1], d[2]];
    }, { src: shot, box });
    assert.ok(px[0]! < 40 && px[1]! < 40 && px[2]! < 50, `the password field is painted over (${px})`);
    await r.shot(panel, "panel-page-attached");

    // the live model list
    await panel.click('[data-a="model"]');
    await panel.waitForSelector("#menu .mi");
    assert.deepEqual(await panel.$$eval("#menu .mi .ell", (e) => e.map((x) => x.textContent)), ["Opus 5.5", "Sonnet 5.5", "Assistant's default (Opus 5.5)"]);
    await r.shot(panel, "panel-model-picker");
    await panel.keyboard.press("Escape");

    // select text on the page with the mouse: the bubble shows and the panel gets a Selected chip
    const q = await page.$("#quote");
    const qb = (await q!.boundingBox())!;
    await page.mouse.move(qb.x + 2, qb.y + 6);
    await page.mouse.down();
    await page.mouse.move(qb.x + 260, qb.y + 8, { steps: 6 });
    await page.mouse.up();
    await panel.waitForSelector(".ch.selq", { timeout: 5000 });
    assert.match(await panel.textContent(".ch.selq .t") ?? "", /^She said her firm loses/);
    await page.waitForSelector("[data-vyre-bubble]", { state: "attached" });
    await r.shot(page, "page-selection-bubble");
    await r.shot(panel, "panel-selected-chip");

    // send: chat.ask carries the page, its screenshot and the selection; the reply streams in
    await panel.fill("#q", "What should I say to her before Thursday's call?");
    await panel.click('[data-a="send"]');
    await r.waitFor(() => r.callsTo("chat.ask")[0], 5000, "chat.ask");
    const ask = r.callsTo("chat.ask")[0]!.input;
    assert.equal(ask.agentId, "agt_assist");
    assert.match(ask.page.shot, /^data:image\/jpeg;base64,/);
    assert.match(ask.selection.text, /^She said her firm/);
    assert.equal(ask.from, "chrome");
    const reply = "Marisol booked a Grow Track Plus discovery call for Thursday at 2:00 PM MST. Before Thursday, send her the Lab 7 replay at 14:20 and one question: how many web leads came in after 5 PM last month?";
    r.bridge.push({ type: "chat.delta", threadId: "thr_1", turnId: "msg_1", text: reply.slice(0, 60), done: false });
    await panel.waitForSelector(".caret");
    r.bridge.push({ type: "chat.delta", threadId: "thr_1", turnId: "msg_1", text: reply, done: true });
    await panel.waitForFunction(() => !document.querySelector(".caret") && document.querySelectorAll(".msg").length === 2);
    assert.equal(await panel.$$eval(".msg .txt", (e) => e.at(-1)!.textContent), reply);
    assert.equal(await panel.$(".ch.selq"), null, "a selection is sent once");
    await r.shot(panel, "panel-reply-streamed");

    // the bubble's Save to Notes clips the selection with a masked screenshot, and the page confirms with Open
    await page.mouse.move(qb.x + 2, qb.y + 6);
    await page.mouse.down();
    await page.mouse.move(qb.x + 200, qb.y + 8, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(() => { const h = document.querySelector("[data-vyre-bubble]") as HTMLElement | null; return h && h.style.display !== "none"; });
    const hb = await page.evaluate(() => { const h = document.querySelector("[data-vyre-bubble]") as HTMLElement; const b = h.getBoundingClientRect(); return { x: b.left, y: b.top }; });
    await page.mouse.click(hb.x + 90, hb.y + 16); // "Save to Notes" sits after the mark
    await r.waitFor(() => r.callsTo("notes.clip")[0], 8000, "notes.clip");
    const clip = r.callsTo("notes.clip")[0]!.input;
    assert.equal(clip.url, `${s.url}/contacts/c_8812`);
    assert.match(clip.selection, /^She said/);
    assert.equal(clip.screenshot.contentType, "image/jpeg");
    await page.waitForSelector("[data-vyre-toast]", { state: "attached" });
    await r.shot(page, "page-saved-to-notes");
  } finally { await r.close(); await s.close(); }
});

test("This site: Never send this site takes the chip, the record and the selection away; dark skin", { skip: !found, timeout: 30_000 }, async () => {
  const s = await site({ "/contacts/c_8812": CONTACT });
  const r = await launch(found!, { colorScheme: "dark", ops: { "agents.list": () => ({ agents: [{ id: "agt_assist", name: "Assistant", assistant: true }], suggested: { id: "agt_assist", name: "Assistant" } }), "records.match": () => ({ records: [{ id: "rec_1", name: "Marisol Vega", kind: "Contact", why: "by email address", chats: [], goals: [] }] }) }, caps: { "engine.models.list": () => ({ models: [] }) } });
  try {
    const page = await r.context.newPage();
    await page.goto(`${s.url}/contacts/c_8812`);
    const panel = await openPanelFor(r, s.url);
    await panel.waitForSelector(".ch.pg .shot img", { timeout: 8000 });
    await r.shot(panel, "panel-dark");
    await panel.click('[data-a="more"]');
    await r.shot(panel, "panel-more-menu-dark");
    await panel.click("#menu .mi:has-text('This site')");
    await panel.waitForSelector(".sheet");
    await panel.click('[data-a="siteOpt"][data-k="never"]');
    await panel.waitForSelector('[data-a="siteOpt"][data-k="never"][aria-checked="true"]');
    await r.shot(panel, "panel-this-site-dark");
    await panel.click('[data-a="back"]');
    await panel.waitForSelector('[data-a="site"]');
    assert.equal(await panel.$(".ch.pg"), null);
    assert.equal(await panel.$(".recl"), null);
    const before = r.callsTo("records.match").length;
    await page.mouse.dblclick(400, 140);
    await new Promise((x) => setTimeout(x, 500));
    assert.equal(await panel.$(".ch.selq"), null, "no Selected chip on a never site");
    assert.equal(r.callsTo("records.match").length, before);
    await r.shot(panel, "panel-never-site-dark");
  } finally { await r.close(); await s.close(); }
});

test("incognito: the panel says Vyre is off, the page gets no bubble, and nothing is asked of the app", { skip: !found, timeout: 30_000 }, async () => {
  const s = await site({ "/contacts/c_8812": CONTACT });
  const r = await launch(found!, { incognito: true }); // "Allow in Incognito" on, so the extension runs there and must keep itself off
  try {
    const win = await r.worker.evaluate(async (u: string) => { const w = await (globalThis as any).chrome.windows.create({ incognito: true, url: u }); return w ? { id: w.id, incognito: w.incognito } : null; }, `${s.url}/contacts/c_8812`);
    assert.ok(win && win.incognito, "an incognito window");
    const page = await r.waitFor(() => r.context.pages().find((p: any) => p.url().includes("/contacts/c_8812")) ?? null, 5000, "the incognito page").catch(() => null);
    const hellos = r.callsTo("hello").length;
    const waiting = r.context.waitForEvent("page", { predicate: (p: any) => p.url().includes("/src/panel/panel.html") });
    await r.worker.evaluate(async (w: number) => { await (globalThis as any).chrome.windows.create({ url: `src/panel/panel.html?window=${w}`, type: "popup", width: 400, height: 760, focused: false }); }, win!.id);
    const panel = await waiting;
    await panel.setViewportSize({ width: 400, height: 760 });
    await panel.waitForSelector(".empty .t");
    assert.equal(await panel.textContent(".empty .t"), "Vyre is off in incognito");
    assert.equal(r.callsTo("hello").length, hellos, "nothing was asked of the app for this window");
    if (page) {
      await page.waitForLoadState();
      await page.mouse.dblclick(400, 140);
      await new Promise((x) => setTimeout(x, 400));
      const bubble = await page.evaluate(() => { const h = document.querySelector("[data-vyre-bubble]") as HTMLElement | null; return h ? h.style.display : "none"; });
      assert.equal(bubble, "none", "no bubble in incognito");
    }
    assert.equal(r.calls.filter((c) => c.name === "records.match" || c.name === "chat.ask" || c.name === "notes.clip").length, 0);
    await r.shot(panel, "panel-incognito-off");
  } finally { await r.close(); await s.close(); }
});
