// The real app, Settings walked as a person: the seven pages, as the Owner and as a Member, in a real Chromium against a Team world. Each page opens, shows its sentence, has no error and no banned word; the
// controls that matter are pressed (a notification channel, the look, GitHub) and the capability they call is checked on the server. Needs VYRE_APP_DIST and Chromium; without them it skips and says why.
// Screenshots of every page, light and dark, desktop and phone, go to shots-evidence/settings/<who>/.
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { guardCrashes } from "../../apps/app/tests/crash-guard.ts";
import { SIZES, bootScreens, browserOrSkip, open, seat, setScheme, shoot } from "./mail-browser.ts";

/** Scroll every scrollable box on the page to its end, so the shot shows what is below the fold. */
async function scrollEnd(page: import("playwright-core").Page): Promise<void> {
  await page.evaluate(() => { for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) { const o = getComputedStyle(el).overflowY; if ((o === "auto" || o === "scroll") && el.scrollHeight > el.clientHeight + 20) el.scrollTop = el.scrollHeight; } });
  await page.waitForTimeout(300);
}
export const OUT = "shots-evidence/settings";
const PAGES: { id: string; title: string; sub: string }[] = [
  { id: "profile", title: "Profile", sub: "How people in this Space see you." },
  { id: "ai", title: "Your AI", sub: "The AI accounts and models you use." },
  { id: "github", title: "GitHub", sub: "One GitHub connection that every model and feature in Vyre uses." },
  { id: "notifications", title: "Notifications", sub: "What reaches you and where." },
  { id: "appearance", title: "Appearance", sub: "How Vyre looks for you." },
  { id: "computer", title: "This device", sub: "This computer and what Vyre can do on it." },
  { id: "signin", title: "Privacy and security", sub: "Your password, two-step sign-in and where you are signed in." },
];
/** GitHub answers as a connected account: the daemon's GitHub egress cannot be faked from a test, so these five reads are answered at the browser's edge; every other call is the real daemon's. */
const gh = { reconnect: false };
const POLICY = { read: "always", push_branch: "ask", open_pr: "ask", comment: "ask", merge: "ask", push_default: "never" };
async function stubGithub(page: import("playwright-core").Page): Promise<void> {
  await page.route(/\/v1\/github\/me\/(status|reach|policy\/get|usage)$/, async (route) => {
    const k = /\/me\/(.+)$/.exec(route.request().url())?.[1];
    const data = k === "status" ? { connected: true, login: "maya-codes", source: "vyre", connectedAt: Date.now() - 9 * 86_400_000, needsReconnect: gh.reconnect }
      : k === "reach" ? { login: "maya-codes", orgs: [{ login: "maya-codes", install: "all", url: "https://github.com/settings/installations/1" }, { login: "northwind-law", install: "selected", url: "https://github.com/organizations/northwind-law/settings/installations/2" }, { login: "closed-org", install: "none", url: "https://github.com/apps/vyre/installations/new/permissions?target_id=10" }], repos: [{ repo: "maya-codes/notes", installationId: 1 }, { repo: "northwind-law/website", installationId: 2 }, { repo: "northwind-law/intake-forms", installationId: 2 }] }
      : k === "usage" ? { uses: [{ consumer: "Scout", repo: "northwind-law/website", action: "pr", at: Date.now() - 3_600_000 }, { consumer: "Scout", repo: "maya-codes/notes", action: "read", at: Date.now() - 86_400_000 }] }
      : { policy: POLICY };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) });
  });
}
const BANNED = ["principal", "grant", "actor", "schema", "gate", "suppression", "retention", "tenant", "capability", "sandbox.denied", "trace"];

export async function walkSettings(t: TestContext, only: "owner" | "member"): Promise<void> {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team" }, env);
  try {
    const w = s.world;
    const member = only === "member" ? await w.join("mia") : null;
    for (const [who, person, role] of (only === "owner" ? [["owner", w.owner, "Owner"]] : [["member", member!, "Member"]]) as readonly (readonly ["owner" | "member", Parameters<typeof seat>[1], string])[]) {
      const me = await seat(s, person, role);
      const dir = `${OUT}/${who}`;
      await me.page.setViewportSize({ width: 1440, height: 900 });   // the prototype's width, for side-by-side shots
      const guard = guardCrashes(me.page);
      await stubGithub(me.page);
      gh.reconnect = false;
      await open(me, s, "/settings?skin=paper");   // Paper for the light pictures, Graphite for the dark ones
      await me.page.getByTestId("settings-place").waitFor({ timeout: 30_000 });
      const nav = (await me.page.getByTestId("settings-nav").innerText()).replace(/\s+/g, " ");
      for (const p of PAGES) assert.ok(nav.includes(p.title), `${who}: the page list has ${p.title}`);
      for (const gone of ["Connected", "Email and calendar", "Memory and privacy", "Skills", "About Vyre"]) assert.ok(!nav.includes(gone), `${who}: ${gone} left the page list`);
      for (const p of PAGES) {
        await me.page.getByTestId(`row-page-${p.id}`).click();
        await me.page.getByTestId(`page-${p.id}`).waitFor({ timeout: 20_000 });
        await me.page.waitForTimeout(800);
        const text = (await me.page.getByTestId(`page-${p.id}`).innerText()).replace(/\s+/g, " ");
        assert.ok(text.includes(p.sub), `${who}/${p.id}: the sentence under the title`);
        for (const b of BANNED) { const m = new RegExp(`(^|[^a-z])${b}([^a-z]|$)`, "i").exec(text); assert.ok(!m, `${who}/${p.id}: no "${b}" in: ...${m ? text.slice(Math.max(0, m.index - 60), m.index + 60) : ""}...`); }
        assert.ok(!/Couldn't load|Something went wrong|undefined|\[object/.test(text), `${who}/${p.id}: no error text`);
        await guard.check(p.id);
        await shoot(me.page, dir, p.id);
        if (["ai", "github", "notifications", "appearance", "signin"].includes(p.id)) {
          await scrollEnd(me.page);
          await guard.check(`${p.id}-end`);
          await shoot(me.page, dir, `${p.id}-end`);
        }
        if (p.id === "github") {
          assert.ok(text.includes("maya-codes") && text.includes("northwind-law"), `${who}: the connected account and its orgs show`);
          gh.reconnect = true;
          await me.page.getByTestId("row-page-profile").click();
          await me.page.getByTestId("row-page-github").click();
          await me.page.getByTestId("page-github").waitFor();
          await me.page.waitForTimeout(800);
          assert.ok((await me.page.getByTestId("page-github").innerText()).includes("Reconnect GitHub once"), `${who}: the reconnect line shows`);
          await guard.check("github-reconnect");
          await shoot(me.page, dir, "github-reconnect");
          gh.reconnect = false;
        }
      }
      // a notification channel and the look, as that person, saved on the server
      await me.page.getByTestId("row-page-notifications").click();
      await me.page.getByTestId("kind-mention-email").click();
      await me.page.waitForTimeout(800);
      const kinds = (await person.ok("notifications.kinds.list")).kinds as { key: string; mine?: { channels: string[] } }[];
      assert.ok(kinds.find((k) => k.key === "mention")?.mine?.channels.includes("email"), `${who}: Email saved for Mentions`);
      await me.page.getByTestId("row-page-appearance").click();
      await me.page.getByTestId("look-rm").click();
      await me.page.waitForTimeout(800);
      const look = (await person.ok("settings.get", { key: "appearance.look" })).row.value as { rm: boolean };
      assert.equal(look.rm, true, `${who}: Reduce motion saved`);
      await setScheme(me.page, "dark");
      await guard.check("appearance-after");
      await shoot(me.page, dir, "appearance-after");
      // the phone: every page, light and dark (the list is one screen and a page another, with a back arrow between them)
      await me.page.setViewportSize(SIZES.phone);
      for (const p of PAGES) {
        await open(me, s, "/settings?skin=paper");
        const row = me.page.getByTestId(`row-page-${p.id}`);
        if (!(await row.isVisible().catch(() => false))) await me.page.getByTestId("back").click().catch(() => undefined);
        await row.click();
        await me.page.getByTestId(`page-${p.id}`).waitFor({ timeout: 20_000 });
        await me.page.waitForTimeout(800);
        const phoneText = (await me.page.getByTestId(`page-${p.id}`).innerText()).replace(/\s+/g, " ");
        assert.ok(phoneText.includes(p.sub), `${who}/${p.id}: the sentence on a phone`);
        await guard.check(`phone-${p.id}`);
        await shoot(me.page, dir, `phone-${p.id}`).then((files) => files.forEach((f) => fs.renameSync(f, f.replace("-desktop.png", "-phone.png"))));
        if (p.id === "github") {
          gh.reconnect = true;
          await open(me, s, "/settings?skin=paper");
          if (!(await me.page.getByTestId("row-page-github").isVisible().catch(() => false))) await me.page.getByTestId("back").click().catch(() => undefined);
          await me.page.getByTestId("row-page-github").click();
          await me.page.getByTestId("page-github").waitFor();
          await me.page.waitForTimeout(800);
          await guard.check("phone-github-reconnect");
          await shoot(me.page, dir, "phone-github-reconnect").then((files) => files.forEach((f) => fs.renameSync(f, f.replace("-desktop.png", "-phone.png"))));
          gh.reconnect = false;
        }
      }
      await me.page.setViewportSize({ width: 1440, height: 900 });
      assert.deepEqual(guard.crashes(), [], `${who}: no crash logged`);
      assert.deepEqual(me.errors, [], `${who}: no page errors`);
    }
  } finally { await s.close(); }
}
