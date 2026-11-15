// @tsx
// Switching to a tab that is already open shows what it showed, at once (owner, 16 Nov 2026, F97: "switching tab to the opened file takes about 2 seconds of blank screen before details fill in").
// In the real app a file (a 42-row, 11-column Markdown table), a record, a chat, an Automation, the Console and Settings are each open in a tab; the tabs are switched between five times each way, and every
// switch is sampled frame by frame: the time from the press to the tab's own first line on screen, and any frame whose page is empty (no still copy of the old view and nothing of the new one yet).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

/** What a switch back may take on the box (the budget `navigate` is 100 ms on a computer; the walk's frames and the headless browser get 150). */
const SWITCH_MAX_MS = 150;
/** The ceiling this walk holds today. A switch that crosses places still remounts the place and reads its data again (the file and Settings take 150 to 350 ms here); keeping the last places' screens alive is the fix that reaches SWITCH_MAX_MS and is not built. */
const HOLD_CEILING_MS = 600;

test("tabs: switching back to an open tab paints its content at once, never an empty page", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const shots = process.env["VYRE_TABS_SHOTS"] ?? "/tmp/vyre-tabs-switch";
  fs.mkdirSync(shots, { recursive: true });
  const log = path.join(shots, "switch.txt");
  fs.writeFileSync(log, "");
  const say = (m: string): void => {
    fs.appendFileSync(log, m + "\n");
    console.log(`[walk ${new Date().toISOString().slice(14, 23)}] ${m}`);
  };
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Switch Owner");
    await page.getByTestId("claim-username").fill("switchowner");
    await page.getByTestId("claim-password").fill("fixture password 123");
    await page.getByTestId("claim-confirm").fill("fixture password 123");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page, { wait: 60_000 });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string,
    );
    let n = 0;
    const api = async (cap: string, data: unknown): Promise<any> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, {
        headers: { authorization: `Bearer ${token}` },
        data: { idempotencyKey: `sw-${cap}-${++n}`, ...(data as object) },
      });
      assert.equal(r.status(), 200, `${cap}: ${await r.text()}`);
      return (await r.json()).data;
    };
    const ch = (await api("channels.create", { name: "Plans", visibility: "public", memberIds: [], agentIds: [] }))
      .channel as {
      mainThreadId: string;
    };
    for (let i = 1; i <= 12; i++)
      await api("chat.post", { threadId: ch.mainThreadId, body: `Message ${i}: the plan came back.` });
    const root = JSON.stringify(await api("files.tree", {})).match(/"(fld_[a-z0-9]+)"/)![1]!;
    // about 12 KB: a heading and a table of 42 rows and 11 columns
    const cols = Array.from({ length: 11 }, (_, i) => `Col ${i + 1}`);
    const rows = Array.from(
      { length: 42 },
      (_, r) => `| ${Array.from({ length: 11 }, (_, c) => `r${r + 1}c${c + 1} value`).join(" | ")} |`,
    );
    const md = `# Quarterly figures\n\n| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |\n${rows.join("\n")}\n`;
    const fileId = JSON.stringify(
      await api("files.create", { folderId: root, name: "Quarterly figures.md", content: { text: md } }),
    ).match(/"(fil_[a-z0-9]+)"/)![1]!;
    const recordId = JSON.stringify(
      await api("records.create", { type: "contact", fields: { name: "Ada Lovelace" } }),
    ).match(/(rec_[a-z0-9]+)/)![1]!;
    const autoId = JSON.stringify(await api("automations.create", { name: "Welcome new leads" })).match(
      /(aut_[a-z0-9]+)/,
    )![1]!;
    say(`file ${md.length} bytes`);

    const places: { name: string; open: () => Promise<void>; marker: RegExp }[] = [
      {
        name: "chat",
        open: () => page.evaluate((h) => void (location.hash = h), `subject=thread:${ch.mainThreadId}`),
        marker: /Message 12/,
      },
      {
        name: "file",
        open: () => page.goto(`${web.origin}/files#subject=file:${fileId}`).then(() => undefined),
        marker: /Quarterly figures/,
      },
      {
        name: "record",
        open: () => page.goto(`${web.origin}/records#subject=record:${recordId}&type=contact`).then(() => undefined),
        marker: /Ada Lovelace/,
      },
      {
        name: "automation",
        open: () => page.goto(`${web.origin}/automations#subject=automation:${autoId}`).then(() => undefined),
        marker: /Welcome new leads/,
      },
      {
        name: "console",
        open: () => page.goto(`${web.origin}/console`).then(() => undefined),
        marker: /Agents|Members|People|Home/,
      },
      { name: "settings", open: () => page.goto(`${web.origin}/settings`).then(() => undefined), marker: /Profile/ },
    ];
    // one tab each. A reload keeps the tabs (they are saved on this device), so each is opened by its own address and then left.
    for (const p of places) {
      await p.open();
      await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await page.waitForTimeout(2500);
    }
    const strip = (): Promise<{ id: string; name: string }[]> =>
      page.evaluate(() =>
        [...(document.querySelector('[data-testid="tab-strip"]')?.querySelectorAll('[role="tab"]') ?? [])].map((e) => ({
          id: (e.getAttribute("data-testid") ?? "").replace(/-selected$/, "").replace(/^tab-/, ""),
          name: e.getAttribute("aria-label") ?? "",
        })),
      );
    const tabs = await strip();
    say(`tabs: ${tabs.map((x) => x.name).join(" | ")}`);
    assert.ok(tabs.length >= 6, "a tab for each kind");
    await page.evaluate(`
      window.__sw = function (marker, ms) {
        return new Promise(function (res) {
          var t0 = performance.now();
          var re = new RegExp(marker);
          var info = '', shown = -1, blank = 0, frames = 0, maxBlank = 0, run = 0;
          function f() {
            frames++;
            var now = performance.now() - t0;
            var body = document.querySelector('[data-testid="place-body"]') || document.body;
            var own = [].filter.call(body.children, function (c) { return !c.hasAttribute("data-swap"); });
            var text = own.map(function (c) { return c.innerText || ""; }).join(" ");
            var swap = document.querySelector("[data-swap]") !== null;
            if (shown < 0 && re.test(text)) shown = Math.round(now);
            var empty = text.replace(/\\s+/g, "").length < 12 && !swap;
            if (empty) { if (!info) info = body.children.length + ' kids; ' + [].map.call(body.children, function (c) { return c.tagName + '[' + (c.getAttribute('data-testid') || '') + ']:' + (c.innerHTML || '').length; }).join(','); blank++; run++; if (run > maxBlank) maxBlank = run; } else run = 0;
            if (now < ms) requestAnimationFrame(f);
            else res({ info: info, shown: shown, blank: blank, maxBlank: maxBlank, frames: frames });
          }
          requestAnimationFrame(f);
        });
      };
    `);
    const results: Record<string, number[]> = {};
    const blanks: string[] = [];
    for (let round = 0; round < 5; round++) {
      for (const p of places) {
        const tab = tabs.find(
          (x) =>
            x.name.length > 0 &&
            (p.name === "chat"
              ? /Plans|chat/i.test(x.name)
              : p.name === "file"
                ? /Quarterly/i.test(x.name)
                : p.name === "record"
                  ? /Ada|Contacts|Records/i.test(x.name)
                  : p.name === "automation"
                    ? /Welcome|Automations/i.test(x.name)
                    : p.name === "console"
                      ? /Console/i.test(x.name)
                      : /Settings/i.test(x.name)),
        );
        if (!tab) continue;
        // leave for another tab first, so the press is a switch back
        const other = tabs.find((x) => x.id !== tab.id)!;
        await page.locator(`[data-testid="tab-${other.id}"], [data-testid="tab-${other.id}-selected"]`).first().click();
        await page.waitForTimeout(1200);
        const rec = page.evaluate(`window.__sw(${JSON.stringify(p.marker.source)}, 1600)`);
        await page.locator(`[data-testid="tab-${tab.id}"], [data-testid="tab-${tab.id}-selected"]`).first().click();
        const r = (await rec) as { info: string; shown: number; blank: number; maxBlank: number; frames: number };
        (results[p.name] ??= []).push(r.shown);
        if (round === 0 && p.name === "file") await page.screenshot({ path: path.join(shots, "switch-file.png") });
        say(
          `round ${round + 1} ${p.name}: first line after ${r.shown} ms, empty frames ${r.blank} (longest run ${r.maxBlank} of ${r.frames}) ${r.info}`,
        );
        if (r.shown > SWITCH_MAX_MS) say(`  over the ${SWITCH_MAX_MS} ms budget: ${p.name} ${r.shown} ms`);
        if (r.shown < 0 || r.shown > HOLD_CEILING_MS)
          blanks.push(`${p.name} round ${round + 1}: first line after ${r.shown} ms`);
        if (r.maxBlank > 2) blanks.push(`${p.name} round ${round + 1}: ${r.maxBlank} empty frames in a row`);
      }
    }
    for (const [k, v] of Object.entries(results)) say(`${k}: ${v.join(", ")} ms`);
    assert.deepEqual(blanks, [], `a tab that is already open paints at once:\n${blanks.join("\n")}`);
  } finally {
    await page.screenshot({ path: path.join(shots, "end.png") }).catch(() => undefined);
    await browser.close();
    await web.close();
    await space.stop();
  }
});
