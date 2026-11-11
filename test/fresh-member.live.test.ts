// A new member's first look (client walk, 11 Nov 2026): every place on a fresh Team Space as a member who has just joined. The Space refuses a member some reads (the Console, policy), so the app must not make them:
// no 4xx or 5xx on any page load, and no page error. Real Chromium against the production export; a refused read a person cannot see still shows red to whoever supports them.
import test from "node:test";
import assert from "node:assert/strict";
import { bootScreens, browserOrSkip, open, seat } from "./support/mail-browser.ts";

const ROUTES = ["/chat", "/records", "/files", "/vault", "/automations", "/sites", "/settings", "/mail"];

test("fresh Team Space, every place as a new member: no refused read, no page error", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team" }, env);
  try {
    const mira = await s.world.join("mira");
    const me = await seat(s, mira, "Member");
    const detail: string[] = [];
    me.page.on("response", (r) => { if (r.status() === 403) void r.text().then((b) => detail.push(`${new URL(r.url()).pathname} ${r.request().postData() ?? ""} -> ${b.slice(0, 200)}`)).catch(() => undefined); });
    for (const route of ROUTES) {
      await open(me, s, route);
      await me.page.waitForTimeout(1500);
      await me.page.screenshot({ path: `shots-evidence/fresh-member${route.replaceAll("/", "-")}.png` });
    }
    const refused = me.logs.filter((l) => /^[45]\d\d /.test(l));
    assert.deepEqual(refused, [], `a member's pages make no read the Space refuses: ${detail.join(" | ")}`);
    assert.deepEqual(me.errors, [], "no page errors");
  } finally { await s.close(); }
});
