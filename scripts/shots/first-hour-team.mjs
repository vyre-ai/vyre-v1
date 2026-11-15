// The Team Space half of the first-hour walk: the owner and a second member, who see each other. Steps are { id, owner, critical?, run(S) } like first-hour-steps.mjs.
// Each step says in a comment whether it is driven through the UI or through the API with the UI read afterwards.
import path from "node:path";
import { claim, connectModel } from "./first-hour-steps.mjs";

const REPO = process.cwd();
const { rawIdsIn } = await import(path.join(REPO, "lib/id-shapes.ts"));
const { permissions: PERMISSION_KEYS } = await import(path.join(REPO, "generated/permissions.ts"));
/** A permission code as the catalogue spells it ("agents.create"): never on a person's screen. */
const DOTTED = new RegExp(`\\b(?:${PERMISSION_KEYS.map((x) => x.key.replace(".", "\\.")).join("|")})\\b`, "g");
const { PAGES: CONSOLE_PAGES } = await import(path.join(REPO, "apps/app/src/console/shell/nav.ts"));
const { PAGES: SETTINGS_PAGES } = await import(path.join(REPO, "apps/app/src/places/settings/model.ts"));

/** A page as the second member sees it: a second browser context that holds her session. */
async function asDana(S) {
  const ctx = await S.page
    .context()
    .browser()
    .newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce" });
  const seed = await ctx.newPage();
  await seed.goto(`${S.web.origin}/home`, { waitUntil: "load", timeout: 60000 });
  const raw = JSON.parse(await S.page.evaluate(() => localStorage.getItem("vyre.session.v1")));
  const mine = raw.sessions[S.web.origin];
  const d = S.state.dana;
  raw.sessions[S.web.origin] = {
    ...mine,
    token: d.token,
    personId: d.personId,
    username: "dana",
    displayName: "Dana Whitfield",
    def: { ...mine.def, role: "Member", console: false, terminal: false, invite: false },
  };
  await seed.evaluate((v) => localStorage.setItem("vyre.session.v1", v), JSON.stringify(raw));
  await seed.close();
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(`page error: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on("response", async (r) => {
    const u = new URL(r.url());
    if (r.status() >= 400 && (u.pathname.startsWith("/v1/") || u.pathname.startsWith("/sync/")))
      errs.push(`Dana HTTP ${r.status()} ${u.pathname} ${(await r.text().catch(() => "")).slice(0, 200)}`);
  });
  return { ctx, page, errs };
}

export const teamSteps = [
  // UI: the claim screens.
  { id: "claim-and-sign-in", owner: "l-entry", critical: true, run: (S) => claim(S, "Olivia Owner", "olivia") },

  // API for the join (the invite page is a separate surface), then the owner's own UI shows Dana in People.
  {
    id: "second-member-joins",
    owner: "l-entry",
    critical: true,
    run: async (S) => {
      const roles = (await S.api("access.roles.list")).roles;
      const inv = await S.api("members.invites.create", { role: roles.find((r) => r.name === "Member").id });
      const code = decodeURIComponent(new URL(inv.link).pathname.split("/").pop());
      const made = await S.makeBundle(S.PW, "recovery-code-for-the-walk", { spaceId: S.space.space });
      const keys = {
        personKeyByPassword: made.personKeyByPassword,
        personKeyByRecovery: made.personKeyByRecovery,
        publicKey: made.publicKey,
        privateKeyWrapped: made.privateKeyWrapped,
        spaceKeys: made.spaceKeys,
      };
      const acc = await fetch(`${S.space.url}/v1/members/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          username: "dana",
          displayName: "Dana Whitfield",
          password: S.PW,
          deviceName: "Dana's PC",
          deviceClass: "desktop",
          keys,
        }),
      });
      if (acc.status !== 200) throw new Error(`members.accept: ${acc.status} ${(await acc.text()).slice(0, 200)}`);
      S.state.dana = (await acc.json()).data;
      S.state.owner = (await S.api("spaces.get")).person ?? null;
      await S.page.goto(`${S.web.origin}/chat`, { waitUntil: "load" });
      await S.page.getByText("Dana Whitfield", { exact: false }).first().waitFor({ timeout: 20000 });
    },
  },

  // API posts the @mention as the owner (the composer's mention picker is chat-lane UI), Dana's own browser then shows the notice in her top bar.
  {
    id: "at-mention",
    owner: "l-chat",
    run: async (S) => {
      const d = S.state.dana;
      const me = await S.api("identity.me").catch(() => null);
      const ownerId =
        me?.person?.id ??
        me?.personId ??
        JSON.parse(await S.page.evaluate(() => localStorage.getItem("vyre.session.v1"))).sessions[S.web.origin]
          .personId;
      S.state.ownerId = ownerId;
      await S.api("notifications.rules.set", { workingHours: null }, d.token).catch(() => undefined);
      const ch = (
        await S.api("channels.create", {
          name: "intake",
          visibility: "public",
          memberIds: [ownerId, d.personId],
          agentIds: [],
        })
      ).channel;
      S.state.channel = ch;
      await S.api("chat.post", {
        threadId: ch.mainThreadId,
        body: "@dana can you take the Rivera intake?",
        mentions: [{ kind: "person", id: d.personId }],
      });
      const dana = await asDana(S);
      S.state.danaView = dana;
      await dana.page.goto(`${S.web.origin}/chat`, { waitUntil: "load" });
      // a member opening Vyre on a device meets the lock screen first (her key is not in this browser's memory): she types her password
      const pw = dana.page.locator("input[type=password]").first();
      if (
        await pw.waitFor({ timeout: 8000 }).then(
          () => true,
          () => false,
        )
      ) {
        await pw.fill(S.PW);
        await pw.press("Enter");
      }
      await S.dismissOnboarding(dana.page).catch(async (e) => {
        await dana.page.screenshot({ path: path.join(S.out, "team-dana-failed.png") });
        throw new Error(
          `Dana's shell did not open: ${String(e).split("\n")[0]} | ${dana.errs.join(" ; ")} | body: ${(
            await dana.page
              .locator("body")
              .innerText()
              .catch(() => "")
          )
            .slice(0, 200)
            .replace(/\n/g, " / ")}`,
        );
      });
      const seen = await dana.page
        .getByText("mentioned you", { exact: false })
        .first()
        .waitFor({ timeout: 20000 })
        .then(
          () => true,
          () => false,
        );
      await dana.page.screenshot({ path: path.join(S.out, "team-dana-mention.png") });
      const notes = (await S.api("notifications.list", {}, d.token)).notifications.map((n) => `${n.kind}:${n.title}`);
      if (dana.errs.length) throw new Error(`Dana's browser: ${dana.errs.join(" ; ")}`);
      if (!seen)
        throw new Error(`Dana's top bar never showed the mention; her notifications are [${notes.join(" | ")}]`);
      // the owner's side: the channel with her message
      await S.page.goto(`${S.web.origin}/chat#subject=thread:${ch.mainThreadId}`, { waitUntil: "load" });
      await S.page.getByText("can you take the Rivera intake", { exact: false }).first().waitFor({ timeout: 20000 });
    },
  },

  // UI: the chat's people menu is where Poke lives (agent row), which only exists on wip/l-share2; this build has no poke capability and no such menu.
  // An agent can be shared in a Team Space (the form's Share button; a Personal Space has no one to share with, so the form does not offer it). Driven by UI: make the agent, open its form by link, press Share.
  {
    id: "share-the-agent",
    owner: "l-share2",
    run: async (S) => {
      const made = await S.api("agents.create", {
        name: "Scout",
        description: "Reads incoming mail and tells me what matters",
      }).catch((e) => {
        throw new Error(`could not make the agent: ${e.message}`);
      });
      const agentId = made.agent?.agentId ?? made.agentId;
      await S.page.goto(`${S.web.origin}/chat#screen=chats.agent-form&agentId=${agentId}`, { waitUntil: "load" });
      await S.page.getByTestId("agent-form").waitFor({ timeout: 30000 });
      for (let i = 0; i < 8 && !(await S.page.getByTestId("agent-share").count()); i++) {
        await S.page.mouse.move(700, 600);
        await S.page.mouse.wheel(0, 700);
        await S.page.waitForTimeout(300);
      }
      await S.page.getByTestId("agent-share").first().click({ timeout: 5000 });
      await S.page.getByTestId("agent-share-overlay").waitFor({ timeout: 10000 });
    },
  },
  {
    id: "poke",
    owner: "l-share2",
    run: async (S) => {
      const ch = S.state.channel;
      await S.page.goto(`${S.web.origin}/chat#subject=thread:${ch.mainThreadId}`, { waitUntil: "load" });
      const count = S.page
        .getByTestId("chat-people")
        .or(S.page.getByLabel(/people|members/i))
        .first();
      await count.waitFor({ timeout: 8000 }).catch(() => {
        throw new Error("no people menu on the chat header in this build");
      });
      await count.click();
      await S.page
        .getByTestId("people-pop")
        .waitFor({ timeout: 5000 })
        .catch(() => {
          throw new Error("the people menu (people-pop) with Add people and Poke is not in this build (wip/l-share2)");
        });
      const agents = await S.api("agents.list", {});
      const a = agents.agents[0];
      await S.page
        .getByTestId(`people-poke-${a.agentId}`)
        .click({ timeout: 5000 })
        .catch(() => {
          throw new Error("no Poke button on the agent row in this build (wip/l-share2)");
        });
    },
  },

  // UI: the add-people sheet from the same menu, with the earlier-messages switch; l-share2 builds it, and keeps the switch hidden until a capability can give a new member the history.
  {
    id: "add-people-sheet",
    owner: "l-share2",
    run: async (S) => {
      const ch = S.state.channel;
      await S.page.goto(`${S.web.origin}/chat#subject=thread:${ch.mainThreadId}`, { waitUntil: "load" });
      const count = S.page
        .getByTestId("chat-people")
        .or(S.page.getByLabel(/people|members/i))
        .first();
      await count.waitFor({ timeout: 8000 }).catch(() => {
        throw new Error("no people menu on the chat header in this build");
      });
      await count.click();
      await S.page
        .getByTestId("people-add")
        .click({ timeout: 5000 })
        .catch(() => {
          throw new Error("no Add people and agents row in the people menu in this build (wip/l-share2)");
        });
      await S.page
        .getByTestId("add-sheet")
        .waitFor({ timeout: 5000 })
        .catch(() => {
          throw new Error("the add-people sheet did not open");
        });
      await S.page
        .getByTestId("as-earlier")
        .waitFor({ timeout: 3000 })
        .catch(() => {
          throw new Error(
            "the earlier-messages switch is not shown (hidden until a capability gives a new member the history)",
          );
        });
    },
  },

  // UI: every Settings page through its nav row (row-page-<key>); each must draw its page, with no refused call and no console error.
  {
    id: "settings-pages",
    owner: "l-settings",
    run: async (S) => {
      const missing = [];
      await S.page.goto(`${S.web.origin}/settings`, { waitUntil: "load" });
      await S.page.getByTestId("settings-place").waitFor({ timeout: 30000 });
      // the Space group of Settings moved to the Console: the nav shows only "You" pages
      for (const pg of SETTINGS_PAGES.filter((x) => x.group === "you")) {
        const row = S.page.getByTestId(`row-page-${pg.key}`);
        if (!(await row.count())) {
          missing.push(`${pg.key} (no nav row)`);
          continue;
        }
        await row.click();
        const drew = await S.page
          .getByTestId(`page-${pg.key}`)
          .waitFor({ timeout: 8000 })
          .then(
            () => true,
            () => false,
          );
        if (!drew) missing.push(`${pg.key} (did not draw)`);
        await S.page.waitForTimeout(500);
        if (pg.key === "profile" || pg.key === "people") await S.shot(`settings-${pg.key}`);
      }
      if (missing.length) throw new Error(`settings pages not reached: ${missing.join(", ")}`);
    },
  },

  // UI: every Console page through the side navigation (a group header, then row-nav-<id>); each must draw with no refused call and no console error.
  {
    id: "console-pages",
    owner: "l-console",
    run: async (S) => {
      const missing = [],
        byPage = new Set();
      let at = "load";
      S.page.on("response", (r) => {
        const u = new URL(r.url());
        if (r.status() >= 400 && u.pathname.startsWith("/v1/")) byPage.add(`${at}: ${r.status()} ${u.pathname}`);
      });
      await S.page.goto(`${S.web.origin}/console`, { waitUntil: "load" });
      await S.page.getByTestId("console").waitFor({ timeout: 30000 });
      for (const pg of CONSOLE_PAGES) {
        at = pg.id;
        if (pg.group) {
          const g = S.page.getByTestId(`navgroup-${pg.group}`);
          if ((await g.count()) && (await g.getAttribute("aria-expanded")) !== "true") await g.click();
        }
        const row = S.page.getByTestId(`row-nav-${pg.id}`);
        if (!(await row.count())) {
          missing.push(`${pg.id} (no nav row)`);
          continue;
        }
        await row.click();
        await S.page.waitForTimeout(700);
        const crashed = await S.page.getByText(/something went wrong|couldn.t open/i).count();
        if (crashed) missing.push(`${pg.id} (crash card)`);
        if (["overview", "people", "usage"].includes(pg.id)) await S.shot(`console-${pg.id}`);
      }
      if (missing.length) throw new Error(`console pages not reached: ${missing.join(", ")}`);
      if (byPage.size) throw new Error(`refused calls by Console page: ${[...byPage].join(" ; ")}`);
    },
  },

  // UI: the Console machines page and the add-a-server sheet.
  {
    id: "machines",
    owner: "l-compute",
    run: async (S) => {
      await S.page.goto(`${S.web.origin}/console`, { waitUntil: "load" });
      await S.page.getByTestId("console").waitFor({ timeout: 30000 });
      // this build has no "Machines" monitor page: the machines are the Agent computers page (Provision computer) and the Server page
      const pg = CONSOLE_PAGES.find((p) => p.id === "computers");
      if (pg.group) {
        const g = S.page.getByTestId(`navgroup-${pg.group}`);
        if ((await g.count()) && (await g.getAttribute("aria-expanded")) !== "true") await g.click();
      }
      await S.page.getByTestId(`row-nav-${pg.id}`).click();
      await S.page.waitForTimeout(1200);
      await S.shot("machines");
      const add = S.page
        .getByRole("button", { name: /provision computer|add (a )?(server|machine|computer)/i })
        .first();
      await add.waitFor({ timeout: 8000 }).catch(() => {
        throw new Error(`no Provision computer or Add server button on ${pg.id}`);
      });
      await add.click();
      await S.page
        .getByRole("dialog")
        .or(S.page.getByTestId(/sheet/))
        .first()
        .waitFor({ timeout: 8000 })
        .catch(() => {
          throw new Error("the add-a-server sheet did not open");
        });
    },
  },

  // ---- w-first (15 Nov 2026): the walker's first pass, fixed. Each step presses the real thing and says what is on screen when it is wrong.
  {
    id: "wf-new-goal",
    owner: "w-first",
    run: async (S) => {
      await S.page.goto(`${S.web.origin}/chat`, { waitUntil: "load" });
      await S.dismissOnboarding(S.page).catch(() => undefined);
      const hint = S.page.getByText("New goal", { exact: true }).first();
      await hint.waitFor({ timeout: 30000 });
      await hint.click();
      await S.page.getByTestId("new-goal-sheet").waitFor({ timeout: 10000 });
      await S.page.getByTestId("new-goal-title").fill("Answer every open question");
      await S.page.screenshot({ path: path.join(S.out, "wf-01-new-goal-sheet.png") });
      await S.page.getByTestId("new-goal-create").click();
      await S.page.getByText("Answer every open question").first().waitFor({ timeout: 20000 });
      await S.page.waitForTimeout(800);
      const body = await S.page.locator("body").innerText();
      if (/not available/i.test(body)) throw new Error(`the new goal opened a refusal: ${body.slice(0, 200)}`);
      await S.page.screenshot({ path: path.join(S.out, "wf-02-new-goal-opened.png") });
    },
  },
  {
    id: "wf-agent-share",
    owner: "w-first",
    run: async (S) => {
      const made = await S.api("agents.create", { name: "Courier", description: "Carries the mail", sharing: "me" });
      const agentId = made.agent?.agentId ?? made.agentId;
      S.state.wfAgent = agentId;
      await S.page.goto(`${S.web.origin}/console#screen=console.page&page=agents&agentId=${agentId}`, {
        waitUntil: "load",
      });
      const share = S.page.getByRole("button", { name: "Share", exact: true }).first();
      await share.waitFor({ timeout: 30000 });
      await S.page.screenshot({ path: path.join(S.out, "wf-03-agent-page.png") });
      await share.click();
      await S.page.getByTestId("share-overlay").waitFor({ timeout: 15000 });
      await S.page.waitForTimeout(800);
      const sheet = await S.page.locator("body").innerText();
      if (!/can use it/.test(sheet)) throw new Error(`the share sheet does not say who has it: ${sheet.slice(0, 300)}`);
      if (!/admin's is shared with everyone/.test(sheet)) throw new Error("the share sheet does not say the rule");
      await S.page.screenshot({ path: path.join(S.out, "wf-04-agent-share-sheet.png") });
      await S.page.keyboard.press("Escape");
      // the Access tab: names and words, no ids and no codes
      await S.page.getByText("Access", { exact: true }).first().click();
      await S.page.waitForTimeout(1200);
      const access = await S.page.locator("body").innerText();
      const bad = [...rawIdsIn(access), ...(access.match(DOTTED) ?? [])];
      if (bad.length) throw new Error(`the Access tab shows ${[...new Set(bad)].join(", ")}`);
      await S.page.screenshot({ path: path.join(S.out, "wf-05-agent-access.png") });
    },
  },
  {
    id: "wf-people-share-everyone",
    owner: "w-first",
    run: async (S) => {
      await S.page.goto(`${S.web.origin}/console#screen=console.page&page=people`, { waitUntil: "load" });
      await S.page.reload({ waitUntil: "load" });
      const btn = S.page.getByTestId("everyone-add");
      await btn.waitFor({ timeout: 30000 });
      const box = await btn.boundingBox();
      await btn.click();
      const menu = S.page.getByRole("menu").first();
      await menu.waitFor({ timeout: 8000 });
      const m = await menu.boundingBox();
      if (!box || !m || m.x < box.x - 40 || m.y < box.y - 10)
        throw new Error(`the menu is not under its button: button ${JSON.stringify(box)} menu ${JSON.stringify(m)}`);
      await S.page.screenshot({ path: path.join(S.out, "wf-06-share-with-everyone.png") });
      await S.page.keyboard.press("Escape");
    },
  },
  {
    id: "wf-words-scan",
    owner: "w-first",
    run: async (S) => {
      // every Console page and every agent tab: no id and no capability name on screen
      const found = [];
      for (const pg of CONSOLE_PAGES) {
        await S.page.goto(`${S.web.origin}/console#screen=console.page&page=${pg.id}`, { waitUntil: "load" });
        await S.page.waitForTimeout(900);
        const t = await S.page.locator("body").innerText();
        for (const x of [...rawIdsIn(t), ...(t.match(DOTTED) ?? [])]) found.push(`${pg.id}: ${x}`);
      }
      for (const tab of ["Overview", "Access", "Activity", "Configuration"]) {
        await S.page.goto(`${S.web.origin}/console#screen=console.page&page=agents&agentId=${S.state.wfAgent}`, {
          waitUntil: "load",
        });
        await S.page.getByText(tab, { exact: true }).first().click({ timeout: 15000 });
        await S.page.waitForTimeout(700);
        const t = await S.page.locator("body").innerText();
        for (const x of [...rawIdsIn(t), ...(t.match(DOTTED) ?? [])]) found.push(`agent ${tab}: ${x}`);
      }
      if (found.length) throw new Error(`ids or codes on screen: ${[...new Set(found)].slice(0, 12).join(" ; ")}`);
    },
  },
  {
    id: "wf-console-home-words",
    owner: "w-first",
    run: async (S) => {
      await S.page.goto(`${S.web.origin}/console#screen=console.page&page=overview`, { waitUntil: "load" });
      await S.page.reload({ waitUntil: "load" });
      await S.page.getByTestId("quick-actions").waitFor({ timeout: 30000 });
      const t = await S.page.locator("body").innerText();
      for (const bad of [/outside agent claimed/i, /0\.0\.0-dev/, /Every computer is fine/])
        if (bad.test(t)) throw new Error(`Console Home still says ${bad}`);
      await S.page.screenshot({ path: path.join(S.out, "wf-07-console-home.png") });
      await S.page.getByTestId("qa-invite-go").click();
      await S.page.getByText("Invite", { exact: false }).first().waitFor({ timeout: 15000 });
      await S.page.getByTestId("invite-sheet").or(S.page.getByRole("dialog")).first().waitFor({ timeout: 15000 });
      await S.page.screenshot({ path: path.join(S.out, "wf-08-invite-sheet-from-home.png") });
      await S.page.keyboard.press("Escape");
    },
  },
  {
    id: "wf-invite-link",
    owner: "w-first",
    run: async (S) => {
      await S.page.goto(`${S.web.origin}/console#screen=console.page&page=people&invite=1`, { waitUntil: "load" });
      await S.page.getByRole("dialog").first().waitFor({ timeout: 30000 });
      const create = S.page.getByRole("button", { name: /create invite|make invite|create link/i }).first();
      await create.click({ timeout: 8000 });
      await S.page.waitForTimeout(1500);
      const t = await S.page.locator("body").innerText();
      const link = (t.match(/https?:\/\/[^\s]+\/join[^\s]*/) ?? [])[0] ?? "";
      if (!link) throw new Error(`no invite link on screen: ${t.slice(0, 300)}`);
      if (new URL(link).origin !== S.web.origin) throw new Error(`the invite link is ${link}, the Space is reached at ${S.web.origin}`);
      await S.page.screenshot({ path: path.join(S.out, "wf-09-invite-link.png") });
    },
  },
  {
    id: "wf-public-channel",
    owner: "w-first",
    run: async (S) => {
      const d = S.state.dana;
      const ownerId = S.state.ownerId ?? (await S.api("identity.me").catch(() => ({}))).person?.id;
      const ch = (await S.api("channels.create", { name: "launch", visibility: "public", memberIds: ownerId ? [ownerId] : [], agentIds: [] })).channel;
      const dana = await asDana(S);
      await dana.page.goto(`${S.web.origin}/chat`, { waitUntil: "load" });
      const pw = dana.page.locator("input[type=password]").first();
      if (await pw.waitFor({ timeout: 8000 }).then(() => true, () => false)) {
        await pw.fill(S.PW);
        await pw.press("Enter");
      }
      await S.dismissOnboarding(dana.page).catch(() => undefined);
      // she is not in #launch: it is in Browse channels, and opening it by its link works
      await dana.page.goto(`${S.web.origin}/open/channel/${ch.channelId}`, { waitUntil: "load" });
      await dana.page.waitForTimeout(3000);
      const t = await dana.page.locator("body").innerText();
      if (/Something in what you entered is not right|Couldn.t load this chat/i.test(t))
        throw new Error(`a member opening a public channel by its link: ${t.replace(/\s+/g, " ").slice(0, 300)}`);
      await dana.page.screenshot({ path: path.join(S.out, "wf-10-member-public-channel.png") });
      await dana.ctx.close();
    },
  },
  {
    id: "wf-connect-after",
    owner: "w-first",
    run: async (S) => {
      // a message waits for lack of an AI account; the account is added elsewhere; the card goes and the message is sent again
      const asst = (await S.api("agents.list", {})).agents.find((a) => a.kind === "assistant") ?? (await S.api("agents.list", {})).agents[0];
      const started = await S.api("chat.start", { kind: "chat", agentIds: [asst.agentId], idempotencyKey: "wf-conn" });
      const threadId = started.thread.threadId;
      await S.api("chat.post", { threadId, body: "Can you summarise my week?", idempotencyKey: "wf-conn-post" });
      await S.page.goto(`${S.web.origin}/chat#subject=thread:${threadId}`, { waitUntil: "load" });
      await S.page.getByText("Connect your AI to get replies", { exact: false }).first().waitFor({ timeout: 30000 });
      await S.page.screenshot({ path: path.join(S.out, "wf-11-connect-card-before.png") });
      await connectModel(S, true);
      await S.page.getByText("Sending your message again", { exact: false }).first().waitFor({ timeout: 30000 });
      await S.page.waitForTimeout(6000);
      await S.page.screenshot({ path: path.join(S.out, "wf-12-connect-card-after.png") });
    },
  },
  {
    id: "wf-notes-and-files",
    owner: "w-first",
    run: async (S) => {
      await S.page.goto(`${S.web.origin}/files`, { waitUntil: "load" });
      await S.page.getByTestId("files-new").waitFor({ timeout: 30000 });
      await S.page.getByTestId("files-new").click();
      const menu = await S.page.getByRole("menu").first().innerText();
      if (/Report a problem/i.test(menu)) throw new Error(`the New menu offers: ${menu.replace(/\n/g, " / ")}`);
      for (const want of ["New Note", "New Folder", "Upload"]) if (!menu.includes(want)) throw new Error(`the New menu has no ${want}: ${menu.replace(/\n/g, " / ")}`);
      await S.page.screenshot({ path: path.join(S.out, "wf-13-files-new-menu.png") });
      await S.page.getByText("New Note", { exact: true }).first().click();
      const title = S.page.getByTestId("take-title");
      await title.waitFor({ timeout: 20000 });
      await S.page.keyboard.type("Plan for Monday");
      const typed = await title.inputValue();
      if (typed !== "Plan for Monday") throw new Error(`typing did not go to the title: ${typed}`);
      await S.page.keyboard.press("Tab");
      await S.page.keyboard.type("First line");
      const open = await S.page.getByRole("menu").count();
      if (open) throw new Error("Tab opened a menu");
      const body = await S.page.getByTestId("take-body").innerText();
      if (!/First line/.test(body)) throw new Error(`Tab did not move to the note: ${body}`);
      await S.page.screenshot({ path: path.join(S.out, "wf-14-new-note.png") });
      await S.page.keyboard.press("Escape");
      await S.page.waitForTimeout(600);
      if (await S.page.getByTestId("take-open").count()) throw new Error("Escape did not close the note");
    },
  },
];
