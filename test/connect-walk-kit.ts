// The connect card in the real app (b-connect3, 16 Nov 2026): the production export in a real browser against a booted daemon whose agent is scripted and whose outside network is a stand-in (never the real Fathom,
// no real key). Two walks. PERSONAL: the owner of a Personal Space is asked "is Fathom connected?", the agent calls vault_connect, ONE card lands in the chat; the person presses and types: an empty Connect says what is
// missing, a wrong key is refused in words and the card stays, an app that cannot be reached offers Retry, Not now folds and Connect opens it, a good key is saved and the agent's waiting call goes on by itself,
// Disconnect removes the connection and the next ask opens the card again with the saved key offered. TEAM: a member (Mia) is asked to connect a Space service she may not connect: "Ask an admin", the admin (Olivia)
// gets the ask, a wrong key stays on her card, the right key finishes Mia's card by itself and the agent goes on, and Disconnect makes the next call ask again. Every state is a picture (VYRE_CONNECT_SHOTS) in
// both skins, at 1440 and 390 wide. The typed keys are in no page text after the card closes.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claimOnEdge, dismissOnboarding, edge } from "../apps/app/tests/real-app-harness.test.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { KEY, boot, scriptedModel, stop } from "./support/eco-live.ts";
import { SPACE_KEY, vendor } from "./member-key-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

export const GOOD = "fth_real_FAKEkeyVALUE0123456789abcdef"; // secret-scan: fake
const PASSWORD = "fixture password 123";
const KEYS = {
  personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk",
  publicKey: "cHVibGljLWtleQ==",
  privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk",
  spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }],
};

type Api = (cap: string, input: unknown) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const withFetchStub = (): (() => void) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    String(url) === "https://api.anthropic.com/v1/models"
      ? Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: "claude-haiku-4-5" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      : realFetch(url, init)) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
};

/** The app's API as a stand-in: "bad" is refused, "offline" cannot be reached, "slow" waits, the rest is accepted. It writes down every key that reached it. */
export const network = (reached: string[]) => ({
  resolve: async () => ["93.184.216.34"],
  request: async (_u: URL, o: { headers: Record<string, string> }) => {
    const key = Object.entries(o.headers).find(([k]) => k.toLowerCase() === "x-api-key")?.[1] ?? "";
    reached.push(key);
    if (key.includes("slow")) await new Promise((r) => setTimeout(r, 2500));
    if (key.startsWith("offline")) throw new Error("ECONNREFUSED");
    return key.startsWith("bad") ? { status: 401, text: "{}" } : { status: 200, text: '{"items":[]}' };
  },
});

export const needChrome = async (t: { skip(m: string): void }) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required");
    t.skip("VYRE_APP_DIST required for production browser evidence");
    return null;
  }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  return { dist, chromium, exe };
};

/** The owner claims the Space in the browser, as a person does; the session it keeps is reused for every later page. */
export async function claim(browser: any, d: Daemon, webOrigin: string): Promise<{ session: string; token: string }> {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const first = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cp = await first.newPage();
  await cp.goto(claimOnEdge(d.claim!.url, webOrigin), { waitUntil: "load" });
  await cp.getByTestId("claim-name").fill("Olivia Owner");
  await cp.getByTestId("claim-username").fill("olivia");
  await cp.getByTestId("claim-password").fill(PASSWORD);
  await cp.getByTestId("claim-confirm").fill(PASSWORD);
  await cp.getByTestId("claim-next").click();
  await cp
    .getByTestId("claim-saved")
    .click({ timeout: 4000 })
    .catch(() => undefined);
  await cp.getByTestId("claim-create").click();
  await dismissOnboarding(cp);
  const session = await cp.evaluate(() => localStorage.getItem("vyre.session.v1")!);
  const token = JSON.parse(session).sessions[webOrigin].token as string;
  await first.close();
  return { session, token };
}

export const apiOf =
  (d: Daemon, token: string): Api =>
  async (cap, input) => {
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ idempotencyKey: `${cap}-${Math.random()}`, ...(input as object) }),
    });
    const b = (await r.json()) as { data?: unknown };
    assert.equal(r.status, 200, `${cap}: ${r.status} ${JSON.stringify(b)}`);
    return b.data ?? b;
  };

/** The owner's own AI account, the way a person connects it, and one agent. */
export async function agentFor(d: Daemon, api: Api, token: string): Promise<string> {
  const unlock = await fetch(`${d.url}/local/vault/key/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` },
    body: JSON.stringify({
      key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64"),
    }),
  });
  assert.equal(unlock.status, 204);
  void token;
  const folder = await api("vault.folders.create", { idempotencyKey: "rc-f", name: "Accounts", scope: "mine" });
  const flow = await api("providers.subscription_start", { idempotencyKey: "rc-fl", providerKey: "claude-code" });
  await api("vault.item.put", {
    idempotencyKey: "rc-i",
    folderId: folder.folder.id,
    name: "Olivia_Claude",
    kind: "ai_subscription",
    fields: [{ key: "setup_token", value: KEY, secret: true }],
  });
  const provider = await api("providers.subscription_complete", { flowId: flow.flowId });
  await api("providers.set_space_use", { idempotencyKey: "rc-su", providerId: provider.provider.id, allow: true });
  return (await api("agents.create", { name: "Dex", role: "You help.", idempotencyKey: "rc-agent" })).agent
    .agentId as string;
}

export const DESKTOP = [
  ["dark", 1440, 900],
  ["light", 1440, 900],
] as const;
export const PHONE = [
  ["dark", 390, 844],
  ["light", 390, 844],
] as const;
export type Skins = readonly (readonly ["dark" | "light", number, number])[];

export async function personalWalk(t: { skip(m: string): void }, SKINS: Skins, label: string): Promise<void> {
  const c = await needChrome(t);
  if (!c) return;
  const shots = process.env["VYRE_CONNECT_SHOTS"] ?? "/tmp/vyre-connect-shots";
  fs.mkdirSync(shots, { recursive: true });
  const undo = withFetchStub();
  const model = scriptedModel(async function* (input, run) {
    const ask = input.trigger?.body ?? "";
    if (/is fathom connected/.test(ask)) {
      const r = yield* run("vault_connect", { service: "Fathom", idempotencyKey: `rc-${Math.random()}` });
      yield { type: "text", text: r.ok ? "Not yet. Add its key and I'll connect it." : "FAILED" };
    } else if (/Carry on/.test(ask)) yield { type: "text", text: "Yes, Fathom is connected." };
  });
  const reached: string[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-connect-real-"));
  const d = await boot(dir, model, {
    vault: undefined,
    connectorNetwork: network(reached),
    config: loadConfig(
      ["--data-dir", dir, "--port", "0", "--space", "spc_7d1e0c2b9a4f5e6d8c3b2a19", "--space-kind", "personal"],
      {},
      "1.2.3",
    ),
  });
  const web = await edge(c.dist, d.url);
  const browser = await c.chromium.launch({ executablePath: c.exe, args: ["--no-sandbox"] });
  const log: string[] = [];
  try {
    assert.ok(d.claim, "a fresh Space prints its claim link");
    const { session, token } = await claim(browser, d, web.origin);
    const api = apiOf(d, token);
    const agentId = await agentFor(d, api, token);
    let n = 0;
    for (const [scheme, w, h] of SKINS) {
      const tag = `${scheme}-${w}`;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
      await ctx.addInitScript((v: string) => {
        try {
          if (!localStorage.getItem("vyre.session.v1")) localStorage.setItem("vyre.session.v1", v);
        } catch {
          /* blocked */
        }
      }, session);
      const page = await ctx.newPage();
      const errs: string[] = [];
      page.on("pageerror", (e) => errs.push(e.message));
      const threadId = (
        await api("chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `rc-chat-${++n}` })
      ).thread.threadId as string;
      const posted = await api("chat.post", {
        threadId,
        body: "is fathom connected?",
        mentions: [{ kind: "agent", id: agentId }],
        idempotencyKey: `rc-post-${n}`,
      });
      await page.goto(`${web.origin}/open/message/${threadId}/${posted.message.messageId}`, { waitUntil: "load" });
      await page
        .getByText("Continue", { exact: true })
        .click({ timeout: 3000 })
        .catch(() => undefined);
      await page
        .getByTestId("onboarding-close")
        .click({ timeout: 4000 })
        .catch(() => undefined);
      const card = page.locator("[data-testid^='connect-vrq_']").first();
      await card.waitFor({ timeout: 120_000 }).catch(async (e) => {
        await page.screenshot({ path: `${shots}/no-card-${tag}.png` });
        const ml = await api("chat.messages.list", { threadId });
        fs.writeFileSync(
          `${shots}/no-card-${tag}.txt`,
          `${page.url()}\n${(await page.locator("body").innerText()).slice(0, 1500)}\n${errs.join("\n")}\n${JSON.stringify(ml).slice(0, 3000)}`,
        );
        throw e;
      });
      const id = (await card.getAttribute("data-testid"))!.replace(/^(connect-vrq_[0-9a-f]+).*$/, "$1");
      const q = (s: string) => page.locator(`[data-testid='${id}${s}']`);
      const shot = async (name: string) => page.screenshot({ path: `${shots}/personal-${name}-${tag}.png` });
      // asked again after the person disconnected it: a new card, with the key the first card saved offered back (Use your saved key, or a different one)
      if (n > 1) {
        await q("-have").waitFor({ timeout: 20_000 });
        await shot("have");
        await q("-other").click();
      }
      await q("-kept").waitFor({ timeout: 20_000 });
      assert.match(
        await q("-checks").innerText(),
        /sent only to api\.fathom\.ai/i,
        "the card says where the key goes before anything is typed",
      );
      await page.waitForTimeout(800);
      await shot("ask");
      // keyboard: Tab order, Kept in opens with Enter, arrows move, Escape closes
      if (scheme === "dark" && w === 1440) {
        await q("-api_key-find").focus();
        const here = () =>
          page.evaluate(
            () =>
              document.activeElement?.getAttribute("data-testid") ??
              document.activeElement?.getAttribute("aria-label") ??
              document.activeElement?.tagName ??
              "",
          );
        const order = [await here()];
        for (let i = 0; i < 9; i++) {
          await page.keyboard.press("Tab");
          order.push(await here());
        }
        log.push(`tab order ${JSON.stringify(order)}`);
        for (const want of ["-api_key-input", "-kept", "-connect", "-later"])
          assert.ok(
            order.some((o) => o.endsWith(want)),
            `Tab reaches ${want}: ${JSON.stringify(order)}`,
          );
        await q("-kept").focus();
        await page.keyboard.press("Enter");
        await page.waitForSelector("[role='menu']", { timeout: 5000 });
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        assert.equal(await page.locator("[role='menu']").count(), 0, "Escape closes the menu");
        log.push("menu: Enter opens, arrows move, Escape closes");
      }
      await q("-kept").click();
      await page.waitForSelector("[role='menu']", { timeout: 5000 });
      await shot("menu");
      await page.keyboard.press("Escape");
      await q("-api_key-eye").click();
      assert.notEqual(await q("-api_key-input").getAttribute("type"), "password", "the eye shows the key");
      await q("-api_key-eye").click();
      await q("-connect").click();
      await page.waitForTimeout(700);
      assert.ok(/needed/i.test(await page.locator("body").innerText()), "an empty Connect says what is missing");

      // working, wrong (the card stays), offline (Retry)
      const before = reached.length;
      await q("-api_key-input").fill("bad-slow-0001");
      await q("-connect").click();
      await page.waitForTimeout(900);
      await shot("working");
      await page.waitForSelector("text=didn't accept this key", { timeout: 15_000 });
      await shot("wrong");
      assert.ok(await q("-connect").count(), "the card stays after a wrong key, ready for another");
      assert.equal(
        (await api("vault.items.list", {})).items.filter((i: { name: string }) => /^Fathom/.test(i.name)).length,
        n - 1,
        "a wrong key saved nothing",
      );
      assert.ok(reached.length > before, "the wrong key really went to the app (the check is a real call)");
      await q("-api_key-input").fill("offline-0001");
      await q("-connect").click();
      await q("-retry").waitFor({ timeout: 10_000 });
      await shot("offline");
      await q("-later").click();
      await q("-reopen").waitFor({ timeout: 8000 });
      await shot("later");
      await q("-reopen").click();
      await q("-connect").waitFor({ timeout: 8000 });
      // connected, opened
      await q("-api_key-input").fill(GOOD);
      await q("-api_key-input").press("Enter");
      const byEnter = await q("-row")
        .waitFor({ timeout: 4000 })
        .then(
          () => true,
          () => false,
        );
      log.push(`${tag}: Enter in the key field connects: ${byEnter}`);
      if (!byEnter) {
        await q("-connect").click();
        await q("-row").waitFor({ timeout: 15_000 });
      }
      await shot("done");
      await q("-row").click();
      await q("-disconnect").waitFor({ timeout: 5000 });
      await shot("doneopen");
      await page.getByText("Yes, Fathom is connected.").first().waitFor({ timeout: 40_000 });
      await shot("after");
      assert.equal((await page.locator("body").innerText()).includes(GOOD), false, "the key is nowhere on the page");
      // Disconnect: the connection goes, the next ask draws the card again
      await q("-disconnect").click();
      await q("-reopen").waitFor({ timeout: 8000 });
      assert.equal(
        (await api("connections.list", {})).connections.filter((x: { connector: string }) => x.connector === "fathom")
          .length,
        0,
        "no connection is left",
      );
      assert.deepEqual(errs, [], "no page errors");
      log.push(`${tag}: all states reached by real presses`);
      await ctx.close();
    }
    fs.writeFileSync(`${shots}/personal-walk-${label}.txt`, log.join("\n") + "\n");
  } finally {
    undo();
    await browser.close();
    await web.close?.();
    await stop(d);
  }
}
export async function teamWalk(t: { skip(m: string): void }, SKINS: Skins, label: string): Promise<void> {
  const c = await needChrome(t);
  if (!c) return;
  const shots = process.env["VYRE_CONNECT_SHOTS"] ?? "/tmp/vyre-connect-shots";
  fs.mkdirSync(shots, { recursive: true });
  const undo = withFetchStub();
  const model = scriptedModel(async function* (input, run) {
    const ask = input.trigger?.body ?? "";
    if (/connect the crm/.test(ask)) {
      const r = yield* run("vault_connect", { service: "Crm app", idempotencyKey: `tc-${Math.random()}` });
      yield { type: "text", text: r.ok ? "Waiting for the Crm app." : "FAILED" };
    } else if (/Carry on|is connected\./.test(ask)) yield { type: "text", text: "Yes, the Crm app is connected." };
  });
  const reached: string[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-connect-team-"));
  const d = await boot(dir, model, {
    vault: undefined,
    connectorNetwork: network(reached),
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_7d1e0c2b9a4f5e6d8c3b2a19"], {}, "1.2.3"),
  });
  const web = await edge(c.dist, d.url);
  const browser = await c.chromium.launch({ executablePath: c.exe, args: ["--no-sandbox"] });
  const log: string[] = [];
  const closers: Array<() => Promise<void>> = [];
  try {
    const { session, token } = await claim(browser, d, web.origin);
    const olivia = apiOf(d, token);
    // the Space's own AI key (a fake provider on this computer), the way an admin sets it for the team, and one agent
    const models = await vendor();
    closers.push(() => models.close());
    const ep = await olivia("providers.custom_add", {
      name: "Provider Go",
      baseUrl: models.base,
      apiKey: SPACE_KEY,
      scope: "mine",
    });
    await olivia("providers.space_key.set", { providerKey: ep.endpoint.key, apiKey: SPACE_KEY });
    const agentId = (await olivia("agents.create", { name: "Dex", role: "You help." })).agent.agentId as string;
    // a Space service: a connector the admin made and published (an API connector made in one call is Space-scope), on a host of its own
    await olivia("connectors.init", {
      key: "crmapp",
      title: "Crm app",
      mode: "api",
      source: false,
      idempotencyKey: "tc-init",
    });
    await olivia("connectors.define", {
      key: "crmapp",
      title: "Crm app",
      domains: ["api.crmapp.example"],
      auth: { type: "api_key", header: "X-Api-Key", prefix: "", secret: "api_key" },
      secrets: [{ name: "api_key", description: "Your Crm app API key" }],
      actions: [{ name: "list_things", method: "GET", url: "https://api.crmapp.example/v1/things" }],
      idempotencyKey: "tc-def",
    });
    assert.equal((await olivia("connectors.publish", { key: "crmapp", idempotencyKey: "tc-pub" })).published, true);
    // Mia joins as a Member, by invite
    const roles = (await olivia("access.roles.list", {})).roles as { id: string; name: string }[];
    const inv = await olivia("members.invites.create", { role: roles.find((r) => r.name === "Member")!.id });
    const code = decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!);
    const joined = await fetch(`${d.url}/v1/members/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code,
        username: "mia",
        displayName: "Mia Member",
        password: PASSWORD,
        deviceName: "Mia's laptop",
        deviceClass: "desktop",
        keys: KEYS,
      }),
    });
    const joinedText = await joined.text();
    assert.equal(joined.status, 200, joinedText);
    const mia = (JSON.parse(joinedText) as { data: { personId: string; token: string } }).data;
    const miaApi = apiOf(d, mia.token);
    // the agent is shared with the Space so Mia can talk to it
    await olivia("agents.share", {
      agentId,
      subject: { kind: "space" },
      level: "use",
      idempotencyKey: "tc-share",
    }).catch(() => undefined);
    // Mia's browser session: the owner's session shape with Mia's token
    const parsed = JSON.parse(session) as { sessions: Record<string, Record<string, unknown>> };
    const mine = {
      ...parsed,
      sessions: {
        ...parsed.sessions,
        [web.origin]: { ...parsed.sessions[web.origin], token: mia.token, personId: mia.personId },
      },
    };
    log.push(`session keys: ${Object.keys(parsed.sessions[web.origin]!).join(",")}`);
    let n = 0;
    for (const [scheme, w, h] of SKINS) {
      const tag = `${scheme}-${w}`;
      const shotAs = (who: string) => `${shots}/team-${who}-`;
      const mctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
      await mctx.addInitScript((v: string) => {
        try {
          localStorage.setItem("vyre.session.v1", v);
        } catch {
          /* blocked */
        }
      }, JSON.stringify(mine));
      const page = await mctx.newPage();
      const errs: string[] = [];
      page.on("pageerror", (e) => errs.push(e.message));
      const threadId = (
        await miaApi("chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `tc-chat-${++n}` })
      ).thread.threadId as string;
      const posted = await miaApi("chat.post", {
        threadId,
        body: "connect the crm",
        mentions: [{ kind: "agent", id: agentId }],
        idempotencyKey: `tc-post-${n}`,
      });
      await page.goto(`${web.origin}/open/message/${threadId}/${posted.message.messageId}`, { waitUntil: "load" });
      await page
        .getByText("Continue", { exact: true })
        .click({ timeout: 3000 })
        .catch(() => undefined);
      await page
        .getByTestId("onboarding-close")
        .click({ timeout: 4000 })
        .catch(() => undefined);
      const card = page.locator("[data-testid^='connect-vrq_']").first();
      await card.waitFor({ timeout: 45_000 }).catch(async (e) => {
        await page.screenshot({ path: `${shots}/team-no-card-${tag}.png` });
        fs.writeFileSync(
          `${shots}/team-no-card-${tag}.txt`,
          `${page.url()}\n${(await page.locator("body").innerText()).slice(0, 1500)}\n${errs.join("\n")}`,
        );
        throw e;
      });
      const id = (await card.getAttribute("data-testid"))!.replace(/^(connect-vrq_[0-9a-f]+).*$/, "$1");
      const q = (s: string) => page.locator(`[data-testid='${id}${s}']`);
      // a member has no right to connect a Space service: the card says so and offers the ask, and it never shows a key field
      await q("-ask").waitFor({ timeout: 20_000 });
      assert.equal(await q("-api_key-input").count(), 0, "a member is given no key field for a Space service");
      await page.screenshot({ path: `${shotAs("mia")}admin-${tag}.png` });
      await q("-ask").click();
      await q("-asked").waitFor({ timeout: 15_000 });
      await page.screenshot({ path: `${shotAs("mia")}asked-${tag}.png` });
      // the admin has the ask, with the same card
      const asks = (await olivia("tasks.list", { scope: "mine" })).tasks as Array<{ title?: string; kind?: string }>;
      assert.ok(
        asks.some((x) => /Connect Crm app/.test(x.title ?? "")),
        `the admin has the ask: ${JSON.stringify(asks).slice(0, 300)}`,
      );
      const requestId = id.replace(/^connect-/, "");
      // the admin's own card: a wrong key stays on it and says so; the right one connects it
      const oc = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
      await oc.addInitScript((v: string) => {
        try {
          localStorage.setItem("vyre.session.v1", v);
        } catch {
          /* blocked */
        }
      }, session);
      const op = await oc.newPage();
      await op.goto(`${web.origin}/inbox`, { waitUntil: "load" });
      await op
        .getByText("Continue", { exact: true })
        .click({ timeout: 2500 })
        .catch(() => undefined);
      await op
        .getByTestId("onboarding-close")
        .click({ timeout: 2500 })
        .catch(() => undefined);
      await op.waitForTimeout(1500);
      await op.screenshot({ path: `${shotAs("olivia")}inbox-${tag}.png` });
      const wrong = await olivia("vault.connect_card.submit", {
        requestId,
        fields: [{ key: "api_key", value: "bad-crm-0001" }],
        idempotencyKey: `tc-bad-${n}`,
      });
      assert.equal(wrong.result, "wrong", "the admin's wrong key is refused");
      assert.equal(wrong.card.state, "wrong", "and the card stays");
      assert.equal(
        (await olivia("connections.list", {})).connections.filter(
          (x: { connector: string }) => x.connector === "crmapp",
        ).length,
        0,
        "nothing connected",
      );
      const right = await olivia("vault.connect_card.submit", {
        requestId,
        fields: [{ key: "api_key", value: GOOD }],
        idempotencyKey: `tc-good-${n}`,
      });
      assert.equal(right.result, "connected");
      // Mia's card finishes by itself, and her agent goes on
      await q("-row").waitFor({ timeout: 30_000 });
      await page.screenshot({ path: `${shotAs("mia")}done-${tag}.png` });
      await page.getByText("Yes, the Crm app is connected.").first().waitFor({ timeout: 40_000 });
      await page.screenshot({ path: `${shotAs("mia")}after-${tag}.png` });
      assert.equal((await page.locator("body").innerText()).includes(GOOD), false, "the key is not on Mia's page");
      // Disconnect (the admin's press): the connection goes, and the next ask is a new ask
      const gone = await olivia("vault.connect_card.disconnect", { requestId, idempotencyKey: `tc-dis-${n}` });
      assert.equal(gone.card.state, "later");
      assert.equal(
        (await olivia("connections.list", {})).connections.filter(
          (x: { connector: string }) => x.connector === "crmapp",
        ).length,
        0,
      );
      assert.deepEqual(errs, [], "no page errors");
      log.push(`${tag}: team walk done`);
      await oc.close();
      await mctx.close();
    }
    fs.writeFileSync(`${shots}/team-walk-${label}.txt`, log.join("\n") + "\n");
  } finally {
    for (const c of closers) await c().catch(() => undefined);
    undo();
    await browser.close();
    await web.close?.();
    await stop(d);
  }
}
