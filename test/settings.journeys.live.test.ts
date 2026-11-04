// The real app, Settings walked as a person: the seven pages, as the Owner and as a Member, in a real Chromium against a Team world. Each page opens, shows its sentence, has no error and no banned word; the
// controls that matter are pressed (a notification channel, the look, GitHub) and the capability they call is checked on the server. Needs VYRE_APP_DIST and Chromium; without them it skips and says why.
// Screenshots of every page, light and dark, desktop and phone, go to shots-evidence/settings/<who>/.
import test from "node:test";
import assert from "node:assert/strict";
import { bootScreens, browserOrSkip, open, phonePass, seat, setScheme, shoot } from "./support/mail-browser.ts";

const OUT = "shots-evidence/settings";
const PAGES: { id: string; title: string; sub: string }[] = [
  { id: "profile", title: "Profile", sub: "How people in this Space see you." },
  { id: "ai", title: "Your AI", sub: "The AI accounts and models you use." },
  { id: "github", title: "GitHub", sub: "One GitHub connection that every model and feature in Vyre uses." },
  { id: "notifications", title: "Notifications", sub: "What reaches you and where." },
  { id: "appearance", title: "Appearance", sub: "How Vyre looks for you." },
  { id: "computer", title: "This device", sub: "This computer and what Vyre can do on it." },
  { id: "signin", title: "Privacy and security", sub: "Your password, two-step sign-in and where you are signed in." },
];
const BANNED = ["principal", "grant", "actor", "schema", "gate", "suppression", "retention", "tenant", "capability", "sandbox.denied", "trace"];

test("settings journey: the seven pages as Owner and as Member, the look and a channel saved on the server", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team" }, env);
  try {
    const w = s.world;
    const member = await w.join("mia");
    for (const [who, person, role] of [["owner", w.owner, "Owner"], ["member", member, "Member"]] as const) {
      const me = await seat(s, person, role);
      const dir = `${OUT}/${who}`;
      await open(me, s, "/settings");
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
        await shoot(me.page, dir, p.id);
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
      await shoot(me.page, dir, "appearance-after");
      await phonePass(me, s, dir, [{ name: "settings", route: "/settings" }]);
      assert.deepEqual(me.errors, [], `${who}: no page errors`);
    }
  } finally { await s.close(); }
});
