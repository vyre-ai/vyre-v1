// The Team Space half of the first-hour walk: the owner and a second member, who see each other. Steps are { id, owner, critical?, run(S) } like first-hour-steps.mjs.
// Each step says in a comment whether it is driven through the UI or through the API with the UI read afterwards.
import path from "node:path";
import { claim } from "./first-hour-steps.mjs";

const REPO = process.cwd();
const { PAGES: CONSOLE_PAGES } = await import(path.join(REPO, "apps/app/src/console/shell/nav.ts"));
const { PAGES: SETTINGS_PAGES } = await import(path.join(REPO, "apps/app/src/places/settings/model.ts"));

/** A page as the second member sees it: a second browser context that holds her session. */
async function asDana(S) {
  const ctx = await S.page.context().browser().newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce" });
  const seed = await ctx.newPage();
  await seed.goto(`${S.web.origin}/home`, { waitUntil: "load", timeout: 60000 });
  const raw = JSON.parse(await S.page.evaluate(() => localStorage.getItem("vyre.session.v1")));
  const mine = raw.sessions[S.web.origin];
  const d = S.state.dana;
  raw.sessions[S.web.origin] = { ...mine, token: d.token, personId: d.personId, username: "dana", displayName: "Dana Whitfield", def: { ...mine.def, role: "Member", console: false, terminal: false, invite: false } };
  await seed.evaluate((v) => localStorage.setItem("vyre.session.v1", v), JSON.stringify(raw));
  await seed.close();
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(`page error: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => { if (m.type() === "error") errs.push(`console: ${m.text().slice(0, 200)}`); });
  page.on("response", async (r) => { const u = new URL(r.url()); if (r.status() >= 400 && (u.pathname.startsWith("/v1/") || u.pathname.startsWith("/sync/"))) errs.push(`Dana HTTP ${r.status()} ${u.pathname} ${(await r.text().catch(() => "")).slice(0, 200)}`); });
  return { ctx, page, errs };
}

export const teamSteps = [
  // UI: the claim screens.
  { id: "claim-and-sign-in", owner: "l-entry", critical: true, run: (S) => claim(S, "Olivia Owner", "olivia") },

  // API for the join (the invite page is a separate surface), then the owner's own UI shows Dana in People.
  { id: "second-member-joins", owner: "l-entry", critical: true, run: async (S) => {
    const roles = (await S.api("access.roles.list")).roles;
    const inv = await S.api("members.invites.create", { role: roles.find((r) => r.name === "Member").id });
    const code = decodeURIComponent(new URL(inv.link).pathname.split("/").pop());
    const made = await S.makeBundle(S.PW, "recovery-code-for-the-walk", { spaceId: S.space.space });
    const keys = { personKeyByPassword: made.personKeyByPassword, personKeyByRecovery: made.personKeyByRecovery, publicKey: made.publicKey, privateKeyWrapped: made.privateKeyWrapped, spaceKeys: made.spaceKeys };
    const acc = await fetch(`${S.space.url}/v1/members/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username: "dana", displayName: "Dana Whitfield", password: S.PW, deviceName: "Dana's PC", deviceClass: "desktop", keys }) });
    if (acc.status !== 200) throw new Error(`members.accept: ${acc.status} ${(await acc.text()).slice(0, 200)}`);
    S.state.dana = (await acc.json()).data;
    S.state.owner = (await S.api("spaces.get")).person ?? null;
    await S.page.goto(`${S.web.origin}/chat`, { waitUntil: "load" });
    await S.page.getByText("Dana Whitfield", { exact: false }).first().waitFor({ timeout: 20000 });
  } },

  // API posts the @mention as the owner (the composer's mention picker is chat-lane UI), Dana's own browser then shows the notice in her top bar.
  { id: "at-mention", owner: "l-chat", run: async (S) => {
    const d = S.state.dana;
    const me = (await S.api("identity.me").catch(() => null));
    const ownerId = me?.person?.id ?? me?.personId ?? JSON.parse(await S.page.evaluate(() => localStorage.getItem("vyre.session.v1"))).sessions[S.web.origin].personId;
    S.state.ownerId = ownerId;
    await S.api("notifications.rules.set", { workingHours: null }, d.token).catch(() => undefined);
    const ch = (await S.api("channels.create", { name: "intake", visibility: "public", memberIds: [ownerId, d.personId], agentIds: [] })).channel;
    S.state.channel = ch;
    await S.api("chat.post", { threadId: ch.mainThreadId, body: "@dana can you take the Rivera intake?", mentions: [{ kind: "person", id: d.personId }] });
    const dana = await asDana(S);
    S.state.danaView = dana;
    await dana.page.goto(`${S.web.origin}/chat`, { waitUntil: "load" });
    // a member opening Vyre on a device meets the lock screen first (her key is not in this browser's memory): she types her password
    const pw = dana.page.locator("input[type=password]").first();
    if (await pw.waitFor({ timeout: 8000 }).then(() => true, () => false)) { await pw.fill(S.PW); await pw.press("Enter"); }
    await S.dismissOnboarding(dana.page).catch(async (e) => { await dana.page.screenshot({ path: path.join(S.out, "team-dana-failed.png") }); throw new Error(`Dana's shell did not open: ${String(e).split("\n")[0]} | ${dana.errs.join(" ; ")} | body: ${(await dana.page.locator("body").innerText().catch(() => "")).slice(0, 200).replace(/\n/g, " / ")}`); });
    const seen = await dana.page.getByText("mentioned you", { exact: false }).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
    await dana.page.screenshot({ path: path.join(S.out, "team-dana-mention.png") });
    const notes = (await S.api("notifications.list", {}, d.token)).notifications.map((n) => `${n.kind}:${n.title}`);
    if (dana.errs.length) throw new Error(`Dana's browser: ${dana.errs.join(" ; ")}`);
    if (!seen) throw new Error(`Dana's top bar never showed the mention; her notifications are [${notes.join(" | ")}]`);
    // the owner's side: the channel with her message
    await S.page.goto(`${S.web.origin}/chat#subject=thread:${ch.mainThreadId}`, { waitUntil: "load" });
    await S.page.getByText("can you take the Rivera intake", { exact: false }).first().waitFor({ timeout: 20000 });
  } },

  // UI: the chat's people menu is where Poke lives (agent row), which only exists on wip/l-share2; this build has no poke capability and no such menu.
  // An agent can be shared in a Team Space (the form's Share button; a Personal Space has no one to share with, so the form does not offer it). Driven by UI: make the agent, open its form by link, press Share.
  { id: "share-the-agent", owner: "l-share2", run: async (S) => {
    const made = await S.api("agents.create", { name: "Scout", description: "Reads incoming mail and tells me what matters" }).catch((e) => { throw new Error(`could not make the agent: ${e.message}`); });
    const agentId = made.agent?.agentId ?? made.agentId;
    await S.page.goto(`${S.web.origin}/chat#screen=chats.agent-form&agentId=${agentId}`, { waitUntil: "load" });
    await S.page.getByTestId("agent-form").waitFor({ timeout: 30000 });
    for (let i = 0; i < 8 && !(await S.page.getByTestId("agent-share").count()); i++) { await S.page.mouse.move(700, 600); await S.page.mouse.wheel(0, 700); await S.page.waitForTimeout(300); }
    await S.page.getByTestId("agent-share").first().click({ timeout: 5000 });
    await S.page.getByTestId("agent-share-overlay").waitFor({ timeout: 10000 });
  } },
  { id: "poke", owner: "l-share2", run: async (S) => {
    const ch = S.state.channel;
    await S.page.goto(`${S.web.origin}/chat#subject=thread:${ch.mainThreadId}`, { waitUntil: "load" });
    const count = S.page.getByTestId("chat-people").or(S.page.getByLabel(/people|members/i)).first();
    await count.waitFor({ timeout: 8000 }).catch(() => { throw new Error("no people menu on the chat header in this build"); });
    await count.click();
    await S.page.getByTestId("people-pop").waitFor({ timeout: 5000 }).catch(() => { throw new Error("the people menu (people-pop) with Add people and Poke is not in this build (wip/l-share2)"); });
    const agents = await S.api("agents.list", {});
    const a = agents.agents[0];
    await S.page.getByTestId(`people-poke-${a.agentId}`).click({ timeout: 5000 }).catch(() => { throw new Error("no Poke button on the agent row in this build (wip/l-share2)"); });
  } },

  // UI: the add-people sheet from the same menu, with the earlier-messages switch; l-share2 builds it, and keeps the switch hidden until a capability can give a new member the history.
  { id: "add-people-sheet", owner: "l-share2", run: async (S) => {
    const ch = S.state.channel;
    await S.page.goto(`${S.web.origin}/chat#subject=thread:${ch.mainThreadId}`, { waitUntil: "load" });
    const count = S.page.getByTestId("chat-people").or(S.page.getByLabel(/people|members/i)).first();
    await count.waitFor({ timeout: 8000 }).catch(() => { throw new Error("no people menu on the chat header in this build"); });
    await count.click();
    await S.page.getByTestId("people-add").click({ timeout: 5000 }).catch(() => { throw new Error("no Add people and agents row in the people menu in this build (wip/l-share2)"); });
    await S.page.getByTestId("add-sheet").waitFor({ timeout: 5000 }).catch(() => { throw new Error("the add-people sheet did not open"); });
    await S.page.getByTestId("as-earlier").waitFor({ timeout: 3000 }).catch(() => { throw new Error("the earlier-messages switch is not shown (hidden until a capability gives a new member the history)"); });
  } },

  // UI: every Settings page through its nav row (row-page-<key>); each must draw its page, with no refused call and no console error.
  { id: "settings-pages", owner: "l-settings", run: async (S) => {
    const missing = [];
    await S.page.goto(`${S.web.origin}/settings`, { waitUntil: "load" });
    await S.page.getByTestId("settings-place").waitFor({ timeout: 30000 });
    // the Space group of Settings moved to the Console: the nav shows only "You" pages
    for (const pg of SETTINGS_PAGES.filter((x) => x.group === "you")) {
      const row = S.page.getByTestId(`row-page-${pg.key}`);
      if (!(await row.count())) { missing.push(`${pg.key} (no nav row)`); continue; }
      await row.click();
      const drew = await S.page.getByTestId(`page-${pg.key}`).waitFor({ timeout: 8000 }).then(() => true, () => false);
      if (!drew) missing.push(`${pg.key} (did not draw)`);
      await S.page.waitForTimeout(500);
      if (pg.key === "profile" || pg.key === "people") await S.shot(`settings-${pg.key}`);
    }
    if (missing.length) throw new Error(`settings pages not reached: ${missing.join(", ")}`);
  } },

  // UI: every Console page through the side navigation (a group header, then row-nav-<id>); each must draw with no refused call and no console error.
  { id: "console-pages", owner: "l-console", run: async (S) => {
    const missing = [], byPage = new Set();
    let at = "load";
    S.page.on("response", (r) => { const u = new URL(r.url()); if (r.status() >= 400 && u.pathname.startsWith("/v1/")) byPage.add(`${at}: ${r.status()} ${u.pathname}`); });
    await S.page.goto(`${S.web.origin}/console`, { waitUntil: "load" });
    await S.page.getByTestId("console").waitFor({ timeout: 30000 });
    for (const pg of CONSOLE_PAGES) {
      at = pg.id;
      if (pg.group) { const g = S.page.getByTestId(`navgroup-${pg.group}`); if (await g.count() && (await g.getAttribute("aria-expanded")) !== "true") await g.click(); }
      const row = S.page.getByTestId(`row-nav-${pg.id}`);
      if (!(await row.count())) { missing.push(`${pg.id} (no nav row)`); continue; }
      await row.click();
      await S.page.waitForTimeout(700);
      const crashed = await S.page.getByText(/something went wrong|couldn.t open/i).count();
      if (crashed) missing.push(`${pg.id} (crash card)`);
      if (["overview", "people", "usage"].includes(pg.id)) await S.shot(`console-${pg.id}`);
    }
    if (missing.length) throw new Error(`console pages not reached: ${missing.join(", ")}`);
    if (byPage.size) throw new Error(`refused calls by Console page: ${[...byPage].join(" ; ")}`);
  } },

  // UI: the Console machines page and the add-a-server sheet.
  { id: "machines", owner: "l-compute", run: async (S) => {
    await S.page.goto(`${S.web.origin}/console`, { waitUntil: "load" });
    await S.page.getByTestId("console").waitFor({ timeout: 30000 });
    // this build has no "Machines" monitor page: the machines are the Agent computers page (Provision computer) and the Server page
    const pg = CONSOLE_PAGES.find((p) => p.id === "computers");
    if (pg.group) { const g = S.page.getByTestId(`navgroup-${pg.group}`); if (await g.count() && (await g.getAttribute("aria-expanded")) !== "true") await g.click(); }
    await S.page.getByTestId(`row-nav-${pg.id}`).click();
    await S.page.waitForTimeout(1200);
    await S.shot("machines");
    const add = S.page.getByRole("button", { name: /provision computer|add (a )?(server|machine|computer)/i }).first();
    await add.waitFor({ timeout: 8000 }).catch(() => { throw new Error(`no Provision computer or Add server button on ${pg.id}`); });
    await add.click();
    await S.page.getByRole("dialog").or(S.page.getByTestId(/sheet/)).first().waitFor({ timeout: 8000 }).catch(() => { throw new Error("the add-a-server sheet did not open"); });
  } },
];
