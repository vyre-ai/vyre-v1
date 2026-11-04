// How long a face takes to appear in the real app (owner polish item, 4 Nov): the first frame after a surface opens, the frame the last face is drawn, on a first open and on a reopen,
// in the sidebar, the chat header, the people popover and the Add sheet. A person's face is a CSS gradient (drawn with the element); an agent's is a bitmap that replaces a tinted placeholder.
// Before the fix (measured on box B): a placeholder frame on every first open, up to 776 ms at page load; after: none on any surface. The test fails if an agent face ever shows its placeholder first.
import test from "node:test";
import assert from "node:assert/strict";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";

test("faces draw in the frame their surface opens, or from the cache on a reopen", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team" }, env);
  try {
    const w = s.world;
    const agent = (await w.owner.ok("agents.create", { name: "Ember", role: "You help.", idempotencyKey: "av-agent" })).agent.agentId as string;
    const threadId = (await w.owner.ok("chat.start", { kind: "chat", agentIds: [agent], idempotencyKey: "av-chat" })).thread.threadId as string;
    const me = await seat(s, w.owner, "Owner");
    await open(me, s, `/chat#screen=chats.conversation&threadId=${threadId}`);
    const page = me.page;
    // for every face inside `root`: how many animation frames until it shows its final face (an <img> or an inline face), and whether the first frame showed a placeholder
    // A MutationObserver sees each avatar the moment it is inserted, before the next paint, and again each time its face changes: the time from insertion to its final face is what a person can see as a flat disc.
    await page.addInitScript({ content: `(function () {
      window.__faces = [];
      var seen = new WeakMap();
      var kindOf = function (el) { return el.querySelector('img') ? 'img' : el.querySelector("svg[viewBox='0 0 16 16']") ? 'placeholder' : el.querySelector('[data-face]') ? 'css' : 'other'; };
      var note = function (el) { var k = kindOf(el); var rec = seen.get(el); var t = performance.now(); if (!rec) { rec = { first: k, t0: t, final: k, tDone: k === 'placeholder' ? null : t, agent: el.getAttribute('data-avatar') === 'agent', root: (el.closest('[data-testid]') || {}).getAttribute ? el.closest('[data-testid]').getAttribute('data-testid') : '' }; seen.set(el, rec); window.__faces.push(rec); } rec.final = k; if (k !== 'placeholder' && rec.tDone === null) rec.tDone = t; };
      new MutationObserver(function () { try { document.querySelectorAll('[data-avatar]').forEach(note); } catch (e) { window.__err = String(e); } }).observe(document, { childList: true, subtree: true, attributes: true });
    })()` });
    const settle = async (): Promise<void> => { await page.waitForTimeout(600); };
    const take = async (label: string): Promise<{ faces: number; firstFramePlaceholders: number; slowestMs: number; kinds: string[] }> => {
      await settle();
      const rows = (await page.evaluate("window.__faces.splice(0)")) as Array<{ first: string; t0: number; tDone: number | null; agent: boolean; final: string; root: string }>;
      const agents = rows.filter((r) => r.agent);
      void label;
      return { faces: rows.length, firstFramePlaceholders: agents.filter((r) => r.first === "placeholder").length, slowestMs: Math.round(Math.max(0, ...agents.map((r) => (r.tDone === null ? 9999 : r.tDone - r.t0)))), kinds: [...new Set(rows.map((r) => `${r.first}>${r.final}`))] };
    };
    await page.reload();
    await page.getByTestId("participants-button").waitFor();
    const report: Record<string, unknown> = {};
    report["page load (sidebar and chat header)"] = await take("load");
    await page.getByTestId("participants-button").click();
    await page.getByTestId("people-popover").waitFor();
    report["popover, first open"] = await take("p1");
    await page.keyboard.press("Escape");
    await page.getByTestId("participants-button").click();
    await page.getByTestId("people-popover").waitFor();
    report["popover, reopen"] = await take("p2");
    await page.getByTestId("people-footer").click();
    await page.getByTestId("add-sheet").waitFor();
    report["add sheet, first open"] = await take("a1");
    await page.getByTestId("as-cancel").click();
    await page.getByTestId("add-sheet").waitFor({ state: "detached" });
    await page.getByTestId("participants-button").click();
    await page.getByTestId("people-footer").click();
    await page.getByTestId("add-sheet").waitFor();
    report["add sheet, reopen"] = await take("a2");
    console.log("AVATAR_DRAW " + JSON.stringify(report));
    for (const k of Object.keys(report)) assert.equal((report[k] as { firstFramePlaceholders: number }).firstFramePlaceholders, 0, `${k}: no agent face shows its placeholder: the face is drawn in the frame its row first appears`);
  } finally { await s.close(); }
});
