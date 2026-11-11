// @tsx
// Shared by records.sharing.live.test.ts (the desktop steps) and records.sharing.phone.live.test.ts (the phone step): the Space, four people, the Deals type and four deals, and the sign-in of one browser.
// Each file holds one half so that each runs inside the 120 s file cap.
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeBundle, wipe } from "../../../client/src/crypto/keys.ts";
import { bootFreshSpace, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "correct horse battery staple 9";
export const OUT = process.env["VYRE_TEST_CAPTURE_DIR"] ?? "shots-evidence/records-sharing";

type Json = { data?: any; error?: { code?: string } };   // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Person { id: string; token: string; username: string; name: string }
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface RsCtx { t: any; web: { origin: string }; ada: Person; bea: Person; cal: Person; dee: Person; deals: Record<string, string>; deal: { type: string; id: string }; post: (cap: string, input: unknown, token?: string) => Promise<{ status: number; body: Json }>; api: (who: Person, cap: string, input?: Record<string, unknown>) => Promise<any>; open: (who: Person, phone?: boolean) => Promise<any> }

export async function recordsSharingSpace(t: any, body: (c: RsCtx) => Promise<void>): Promise<void> {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST is not set: the shots job runs this after the production export"); return; }
  const pw = await import("playwright-core");
  const chromium = pw.chromium ?? (pw as unknown as { default: typeof pw }).default.chromium;
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  if (!fs.existsSync(exe)) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail(`no Chromium at ${exe}`); t.skip("no Chromium on this machine"); return; }

  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  fs.mkdirSync(OUT, { recursive: true });
  try {
    // ---- the Space, made the way the apps make it: real key bundles, a claim, three invitations
    const post = async (cap: string, input: unknown, token?: string): Promise<{ status: number; body: Json }> => {
      const r = await fetch(`${space.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
      return { status: r.status, body: (await r.json()) as Json };
    };
    const keysFor = async (password: string): Promise<Record<string, unknown>> => {
      const made = await makeBundle(password, "recovery-code-for-the-test", { spaceId: space.space });
      const { personKey, ...rest } = made;
      wipe(personKey);
      return { personKeyByPassword: rest.personKeyByPassword, personKeyByRecovery: rest.personKeyByRecovery, publicKey: rest.publicKey, privateKeyWrapped: rest.privateKeyWrapped, spaceKeys: rest.spaceKeys };
    };
    const code = decodeURIComponent(new URL(space.claim!).pathname.split("/").pop() ?? "");
    const claimed = await post("identity.claim_owner", { code, spaceId: space.space, username: "ada", displayName: "Ada Archer", password: PASSWORD, deviceName: "Setup", deviceClass: "desktop", keys: await keysFor(PASSWORD) });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    const adaToken = claimed.body.data.session.token as string;
    const who = await post("identity.whoami", {}, adaToken);
    assert.equal(who.status, 200, JSON.stringify(who.body));
    const ada: Person = { id: who.body.data.principal.id, token: adaToken, username: "ada", name: "Ada Archer" };
    let n = 0;
    const api = async (who: Person, cap: string, input: Record<string, unknown> = {}): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await post(cap, { idempotencyKey: `rs-e2e-${++n}`, ...input }, who.token);
      assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.body)}`);
      return r.body.data;
    };
    const roles = (await api(ada, "access.roles.list")).roles as Array<{ id: string; name: string }>;
    const member = roles.find((r) => r.name === "Member")!.id;
    const join = async (username: string, name: string): Promise<Person> => {
      const invite = await api(ada, "members.invites.create", { role: member });
      const accepted = await post("members.accept", { code: decodeURIComponent(new URL(invite.link).pathname.split("/").pop() ?? ""), username, displayName: name, password: PASSWORD, deviceName: "Setup", deviceClass: "desktop", keys: await keysFor(PASSWORD) });
      assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
      return { id: accepted.body.data.personId, token: accepted.body.data.token, username, name };
    };
    const bea = await join("bea", "Bea Baker");
    const cal = await join("cal", "Cal Cruz");
    const dee = await join("dee", "Dee Dunn");

    await api(ada, "schema.apply", { ops: [{ op: "type.create", type: "rt_deal", def: { title: "Deal", plural: "Deals", icon: "invoice", titleField: "name", fields: [
      { key: "name", type: "text", title: "Name", required: true }, { key: "stage", type: "text", title: "Stage" }, { key: "value", type: "number", title: "Value" },
    ] } }] });
    const deals: Record<string, string> = {};
    for (const [name, stage, value] of [["Acme renewal", "Proposal", 48000], ["Birch lease", "Won", 21000], ["Cedar upsell", "Lead", 9500], ["Dune expansion", "Proposal", 76000]] as const) {
      deals[name] = (await api(ada, "records.create", { type: "rt_deal", fields: { name, stage, value } })).record.id as string;
    }
    const deal = { type: "record_type", id: "rt_deal" };

    // ---- four browsers, each signed in through the sign-in screen
    const consoleErrors: string[] = [];
    const open = async (who: Person, phone = false): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 780 } : { width: 1280, height: 800 }, colorScheme: "light", ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
      const page = await ctx.newPage();
      page.on("pageerror", (e: Error) => consoleErrors.push(`${who.name}: ${e.message}`));
      await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
      await page.getByTestId("si-user").waitFor({ timeout: 20_000 });
      await page.getByTestId("si-user").fill(who.username);
      await page.getByTestId("si-password").fill(PASSWORD);
      await page.getByTestId("next").click();
      await dismissOnboarding(page);
      return page;
    };
    await body({ t, web, ada, bea, cal, dee, deals, deal, post, api, open });
    assert.deepEqual(consoleErrors, [], "no page error in any browser");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
    fs.rmSync(space.dir, { recursive: true, force: true });
  }
}
