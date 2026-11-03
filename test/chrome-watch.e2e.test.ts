// "Watch a page" in a real headless Chromium with the unpacked extension (tests/e2e/rig.ts): pick a part of the page, start a watch, a change tells the chat what it was and what it is,
// the Watching list, Check now and Pause; and recording and watching are refused on a site that is never sent. Screenshots go to VYRE_SHOT_DIR.
import test from "node:test";
import assert from "node:assert/strict";
import { findChromium, launch, site } from "../apps/chrome/tests/e2e/rig.ts";
import { changeWords, normalize } from "../modules/automations/handlers/watches.ts";
import { AGENTS, LAB, lab, openPanelFor, shootAll } from "../apps/chrome/tests/e2e/show-watch.ts";

const found = await findChromium();

test("a watch: pick a part of the page, start it, a change tells the chat what it was and what it is; the Watching list and Check now", { skip: !found, timeout: 60_000 }, async () => {
  lab.going = "3,412 going";
  const s = await site({ "/lab": () => LAB() });
  const store: any[] = [];
  const alerts: string[] = [];
  const report = (i: any) => {
    const w = store.find((x) => x.watchId === i.watchId)!;
    const now = Date.now();
    w.lastCheckedAt = now; w.checkNow = false; w.nextDueAt = now + w.everyMinutes * 60_000;
    let changed = false;
    if (i.value === undefined) { w.error = i.error; w.state = "error"; } else {
      const next = normalize(i.value);
      if (w.value !== undefined && w.value !== next) { changed = true; w.changes += 1; w.lastChange = { at: now, before: w.value, after: next }; alerts.push(changeWords(w, w.value, next)); }
      w.value = next; w.error = undefined; w.state = "on";
    }
    return { changed, watch: w };
  };
  const r = await launch(found!, {
    ops: { "agents.list": AGENTS, "people.list": () => ({ people: [{ id: "usr_me", name: "Me" }, { id: "usr_aliza", name: "Aliza" }], channels: [{ id: "chn_mkt", threadId: "thr_mkt", name: "marketing" }], me: "usr_me" }), "goals.pick": () => ({ goals: [{ id: "gol_lab8", title: "Lab 8: 5,000 registrations", value: 3412, target: 5000 }] }), "app.open": () => ({ opened: "app" }), "chat.ask": () => ({ threadId: "thr_pc", turnId: "m" }) },
    caps: {
      "automations.watches.list": (i) => ({ watches: store.filter((w) => (!i.watchId || w.watchId === i.watchId) && (!i.runsOn || w.runsOn === i.runsOn)) }),
      "automations.watches.save": (i) => {
        const now = Date.now();
        const w = { watchId: `wch_${store.length + 1}`, title: i.title, url: i.url, host: new URL(i.url).hostname, mode: i.mode, region: i.region, everyMinutes: i.everyMinutes, tell: [], agentId: i.agentId, runsOn: i.runsOn, state: "on", checkNow: false, value: i.value === undefined ? undefined : normalize(i.value), lastCheckedAt: now, nextDueAt: now + i.everyMinutes * 60_000, changes: 0, createdAt: now, updatedAt: now };
        store.push(w);
        return { watch: w };
      },
      "automations.watches.report": report,
      "automations.watches.check": (i) => { store.find((w) => w.watchId === i.watchId)!.checkNow = true; return { watch: store[0] }; },
      "automations.watches.remove": (i) => { const w = store.find((x) => x.watchId === i.watchId)!; if (i.op === "remove") { store.splice(store.indexOf(w), 1); return { removed: true }; } w.state = i.op === "pause" ? "paused" : "on"; return { removed: false, watch: w }; },
    },
  });
  try {
    const page = await r.context.newPage();
    await page.goto(`${s.url}/lab`);
    await page.bringToFront();
    const panel = await openPanelFor(r, s.url);
    await panel.waitForSelector(".ch.pg .t", { timeout: 10_000 });
    await panel.click('[data-a="more"]');
    await panel.click("#menu .mi:has-text('Watch this page')");
    await panel.waitForSelector(".sheet");
    await shootAll(r, panel, "chrome2b-watch-sheet-empty");
    assert.equal(await panel.isDisabled('[data-a="wStart"]'), true, "a part of the page must be picked first");

    // pick the part: the page outlines what is under the pointer, the click names it
    await panel.click('[data-a="pickStart"]');
    await page.waitForSelector("[data-vyre-pick]", { state: "attached" });
    const box = (await (await page.$("#going"))!.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.screenshot({ path: `${process.env["VYRE_SHOT_DIR"] ?? "/tmp/vyre-chrome-e2e-shots"}/chrome2b-watch-picking-page.png` });
    await page.mouse.click(box.x + 20, box.y + 10);
    await panel.waitForFunction(() => document.body.textContent!.includes("Guest count"));
    assert.equal(await page.$("[data-vyre-pick]"), null, "the picker is gone");

    // Ops has a computer, Scout has none: the default follows the agent
    await panel.click('[data-a="wWho"]');
    await panel.click("#menu .mi:has-text('Ops')");
    assert.match(await panel.textContent(".seg .on") ?? "", /Agent computer/);
    await panel.click('[data-a="wWho"]');
    await panel.click("#menu .mi:has-text('Scout')");
    assert.match(await panel.textContent(".seg .on") ?? "", /My Chrome/);
    assert.match(await panel.textContent(".sheet .note:has(.lnk)") ?? "", /Give Scout one/);
    await panel.click('[data-a="givePc"]');
    await r.waitFor(() => r.callsTo("chat.ask")[0], 4000, "chat.ask for the computer");
    assert.match(r.callsTo("chat.ask")[0]!.input.text, /set up your own computer/);
    await panel.click('[data-a="wFreq"]');
    await panel.click("#menu .mi:has-text('Every 15 minutes')");
    await shootAll(r, panel, "chrome2b-watch-sheet-picked");
    await panel.click('[data-a="wTell"]');
    await panel.click('[data-a="wTellPerson"][data-k="usr_aliza"]');
    await panel.click('[data-a="wTellThread"][data-k="thr_mkt"]');
    assert.equal(await panel.$('[data-a="wTellPerson"][data-k="usr_me"]'), null);
    assert.match(await panel.textContent('[data-a="wTell"]') ?? "", /Also Aliza and #marketing/);
    await panel.click('[data-a="wGoal"]');
    assert.equal(await panel.getAttribute('[data-a="wGoalPick"][data-k="gol_lab8"]', "aria-checked"), "true", "a single goal is picked for them");
    await panel.click('[data-a="wGoalPick"][data-k="gol_lab8"]');
    await shootAll(r, panel, "chrome2b-watch-sheet-tell-goal");
    await panel.click('[data-a="wStart"]');
    await panel.waitForSelector(".rowh");
    assert.deepEqual(r.callsTo("automations.watches.save")[0]!.input.tell, ["usr_aliza"]);
    assert.deepEqual(r.callsTo("automations.watches.save")[0]!.input.tellThreads, ["thr_mkt"]);
    assert.equal(r.callsTo("automations.watches.save")[0]!.input.goalId, "gol_lab8");
    const w = store[0];
    assert.deepEqual([w.title, w.mode, w.region.label, w.region.selector, w.everyMinutes, w.runsOn, w.agentId, w.value], ["AI Lab 8 · Luma", "region", "Guest count", "#going", 15, "chrome", "agt_scout", "3,412 going"]);
    await shootAll(r, panel, "chrome2b-watching-list");

    // the page changes; the extension looks (the app asked it to with watch.run) and reports; the app tells the chat with before and after
    lab.going = "3,598 going";
    w.nextDueAt = Date.now() - 1000;
    r.bridge.push({ type: "watch.run", watchId: w.watchId });
    await r.waitFor(() => alerts[0], 15_000, "the change alert");
    assert.equal(alerts[0], `AI Lab 8 · Luma changed (Guest count).\n\nBefore: 3,412 going\nNow: 3,598 going\n\n${s.url}/lab`);
    assert.equal(r.context.pages().filter((p: any) => p.url().includes("/lab")).length, 1, "the background tab is closed again");

    // the list says so; Check now with no change says nothing more
    await panel.click('[data-a="sheetX"]');
    await panel.click('[data-a="more"]');
    await panel.click("#menu .mi:has-text('Watching')");
    await panel.waitForFunction(() => /Changed/.test(document.querySelector(".rowh")?.textContent ?? ""));
    await panel.click('[data-a="wRow"]');
    await panel.waitForSelector("text=Before");
    assert.match(await panel.textContent(".rowh") ?? "", /3,412 going[\s\S]*3,598 going/);
    await shootAll(r, panel, "chrome2b-watching-changed");
    await panel.click('[data-a="wMore"]');
    await panel.click("#menu .mi:has-text('Check now')");
    await r.waitFor(() => r.callsTo("automations.watches.report").length >= 2, 15_000, "a second report");
    assert.equal(alerts.length, 1);
    await panel.click('[data-a="wPause"]');
    await r.waitFor(() => store[0].state === "paused", 4000, "paused");
    await shootAll(r, panel, "chrome2b-watching-paused");
  } finally { await r.close(); await s.close(); }
});

test("recording and watching are off on a site that is never sent", { skip: !found, timeout: 30_000 }, async () => {
  const s = await site({ "/lab": () => LAB() });
  const r = await launch(found!, { ops: { "agents.list": AGENTS }, caps: { "automations.watches.list": () => ({ watches: [] }) } });
  try {
    const page = await r.context.newPage();
    await page.goto(`${s.url}/lab`);
    await page.bringToFront();
    const panel = await openPanelFor(r, s.url);
    await panel.waitForSelector(".ch.pg .t", { timeout: 10_000 });
    await panel.click('[data-a="more"]');
    await panel.click("#menu .mi:has-text('This site')");
    await panel.click('[data-a="siteOpt"][data-k="never"]');
    await panel.waitForSelector('[data-a="siteOpt"][data-k="never"][aria-checked="true"]');
    await panel.click('[data-a="back"]');
    await panel.click('[data-a="more"]');
    assert.equal(await panel.getAttribute("#menu .mi:has-text('Watch this page')", "aria-disabled"), "true");
    assert.equal(await panel.getAttribute("#menu .mi:has-text('Show Vyre how')", "aria-disabled"), "true");
    const res = await panel.evaluate(async () => new Promise((resolve) => (globalThis as any).chrome.runtime.sendMessage({ type: "panel.rec.start", windowId: Number(new URLSearchParams(location.search).get("window")) }, (x: any) => resolve(x))));
    assert.equal((res as any).error?.code, "never_site", JSON.stringify(res));
    const watch = await panel.evaluate(async () => new Promise((resolve) => (globalThis as any).chrome.runtime.sendMessage({ type: "panel.watch.pick", windowId: Number(new URLSearchParams(location.search).get("window")) }, (x: any) => resolve(x))));
    assert.equal((watch as any).error.code, "never_site");
    assert.equal(await page.$("[data-vyre-recbar]"), null);
  } finally { await r.close(); await s.close(); }
});

