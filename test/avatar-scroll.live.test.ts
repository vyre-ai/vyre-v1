// Scroll speed with many agent faces on screen (lead, 4 Nov: drawing faces synchronously in render must not cost scroll speed): 60 agents in a team Space; the Add people and agents sheet lists them all (the Chats sidebar shows only a few). Reports the time
// from navigation until every face is drawn, and the frame times while the sidebar scrolls top to bottom and back. Budget: the Files list's frame budget (perf/budgets.json "scroll", 16.7 ms p95).
import test from "node:test";
import assert from "node:assert/strict";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";

test("60 agent faces: mount time and scroll frames", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team" }, env);
  try {
    const w = s.world;
    const ids: string[] = [];
    for (let n = 0; n < 60; n++) ids.push((await w.owner.ok("agents.create", { name: `Agent ${String(n).padStart(3, "0")}`, role: "You help.", idempotencyKey: `sc-a${n}` })).agent.agentId as string);
    const threadId = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [ids[0]], idempotencyKey: "sc-chat" })).thread.threadId as string;
    const me = await seat(s, w.owner, "Owner");
    const t0 = Date.now();
    await open(me, s, `/chat#screen=chats.conversation&threadId=${threadId}`);
    const page = me.page;
    await page.getByTestId("participants-button").waitFor();
    const tOpen = Date.now();
    await page.getByTestId("participants-button").click();
    await page.getByTestId("people-footer").click();
    await page.getByTestId("add-sheet").waitFor();
    await page.waitForFunction("document.querySelectorAll('[data-testid=add-sheet] [data-avatar=agent]').length >= 20", undefined, { timeout: 30_000 });
    const openMs = Date.now() - tOpen;
    const probe = `(async function () {
      var faces = function () { return document.querySelectorAll('[data-testid=add-sheet] [data-avatar=agent]').length; };
      var placeholders = function () { return Array.prototype.filter.call(document.querySelectorAll('[data-testid=add-sheet] [data-avatar=agent]'), function (f) { return !f.querySelector('img') && !!f.querySelector("svg[viewBox='0 0 16 16']"); }).length; };
      var start = performance.now(); var until = start + 8000; var stable = 0, last = -1;
      while (performance.now() < until && stable < 10) { await new Promise(function (r) { requestAnimationFrame(function () { r(null); }); }); var n = faces(); if (n === last && placeholders() === 0) stable++; else stable = 0; last = n; }
      var settleMs = Math.round(performance.now() - start);
      // the largest scrollable ancestor of an agent face is the sheet's list
      var el = document.querySelector('[data-testid=add-sheet] [data-avatar=agent]'); var sc = null;
      while (el) { if (el.scrollHeight > el.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) { sc = el; break; } el = el.parentElement; }
      var frames = [];
      if (sc) {
        var prev = performance.now(); var dir = 1; var steps = 0; var max = sc.scrollHeight - sc.clientHeight;
        while (steps < 240) { sc.scrollTop = Math.max(0, Math.min(max, sc.scrollTop + dir * 40)); if (sc.scrollTop >= max) dir = -1; await new Promise(function (r) { requestAnimationFrame(function () { r(null); }); }); var now = performance.now(); frames.push(now - prev); prev = now; steps++; }
      }
      frames.sort(function (a, b) { return a - b; });
      var q = function (p) { return frames.length ? Math.round(frames[Math.min(frames.length - 1, Math.floor(frames.length * p))] * 10) / 10 : null; };
      return { faces: faces(), settleMs: settleMs, scrollable: !!sc, frames: frames.length, p50: q(0.5), p95: q(0.95), max: q(1) };
    })()`;
    const r = await page.evaluate(probe) as Record<string, unknown>;
    console.log("AVATAR_SCROLL " + JSON.stringify({ ...r, openToFacesMs: openMs, totalMs: Date.now() - tOpen }));
    assert.ok(Number(r["faces"]) >= 20, "agent faces are on screen");
  } finally { await s.close(); }
});
