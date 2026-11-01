// Records sharing in the real app (DESIGN-records-sharing): a Team Space with four people, each in their own browser on the production export, signed in through the sign-in screen. Ada makes
// Deals Only people added and adds Bea (Can edit) and Cal (Can view); Bea edits a deal; Cal sees it read only, with no Export and no Share; Dee, who was not added, has no Deals type; Ada turns Can export
// on for Cal and his Export button appears without a refresh and exports a CSV of the rows he can see; Ada sets one deal to Only me and it leaves Bea's and Cal's tables at once.
// Every step is photographed in light and dark, on desktop and on a phone (VYRE_TEST_CAPTURE_DIR, default shots-evidence/records-sharing). Needs VYRE_APP_DIST (the production web export) and a Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeBundle, wipe } from "../../../client/src/crypto/keys.ts";
import { bootFreshSpace, dismissOnboarding, edge } from "./real-app-harness.test.ts";

const PASSWORD = "correct horse battery staple 9";
const OUT = process.env["VYRE_TEST_CAPTURE_DIR"] ?? "shots-evidence/records-sharing";

type Json = { data?: any; error?: { code?: string } };   // eslint-disable-line @typescript-eslint/no-explicit-any
interface Person { id: string; token: string; username: string; name: string }

test("records sharing in the real app: Deals for Bea to edit and Cal to view, nothing for Dee, export on request, one deal Only me", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST is not set: the shots job runs this after the production export"); return; }
  const pw = await import("playwright-core");
  const chromium = pw.chromium ?? (pw as unknown as { default: typeof pw }).default.chromium;
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  if (!fs.existsSync(exe)) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail(`no Chromium at ${exe}`); t.skip("no Chromium on this machine"); return; }

  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  fs.rmSync(OUT, { recursive: true, force: true });
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
    const open = async (who: Person): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
      const page = await ctx.newPage();
      page.on("pageerror", (e: Error) => consoleErrors.push(`${who.name}: ${e.message}`));
      await page.goto(`${web.origin}/home`, { waitUntil: "load" });
      await page.getByTestId("si-user").waitFor({ timeout: 20_000 });
      await page.getByTestId("si-user").fill(who.username);
      await page.getByTestId("si-password").fill(PASSWORD);
      await page.getByTestId("next").click();
      await dismissOnboarding(page);
      return page;
    };
    const A = await open(ada), B = await open(bea), C = await open(cal), D = await open(dee);

    // ---- pictures: light and dark on desktop and on a phone, the page put back where it was
    let shot = 0;
    const snap = async (page: any, name: string): Promise<void> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      shot++;
      const label = `${String(shot).padStart(2, "0")}-${name}`;
      for (const [vp, w, h] of [["desktop", 1280, 800], ["phone", 390, 780]] as const) for (const mode of ["light", "dark"] as const) {
        await page.setViewportSize({ width: w, height: h });
        await page.emulateMedia({ colorScheme: mode });
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(OUT, `${label}-${vp}-${mode}.png`) });
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.emulateMedia({ colorScheme: "light" });
      await page.waitForTimeout(250);
    };
    const toDeals = async (page: any): Promise<void> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      await page.getByTestId("rail-records").or(page.getByTestId("rail-records-selected")).first().click();
      await page.getByTestId("records-place").waitFor({ timeout: 20_000 });
      await page.getByTestId("row-nav:type:rt_deal").click();
      await page.getByTestId(`rec-${deals["Acme renewal"]}`).waitFor({ timeout: 20_000 });
    };
    const count = (page: any, id: string): Promise<number> => page.getByTestId(id).count();   // eslint-disable-line @typescript-eslint/no-explicit-any

    await t.test("1 Ada opens Deals: everyone in the Space reaches it, and Share is on the header", async () => {
      await toDeals(A);
      await A.getByTestId("records-share-btn").waitFor({ timeout: 15_000 });
      assert.equal(await count(A, "records-export-btn"), 1, "an admin can export");
      await snap(A, "ada-deals");
    });

    await t.test("2 Ada's Share sheet: Who can see this, and nobody added yet", async () => {
      await A.getByTestId("records-share-btn").click();
      await A.getByTestId("records-share").waitFor();
      await A.getByTestId("share-audience").waitFor();
      assert.equal(await A.getByTestId("share-audience-pick-space").getAttribute("aria-selected"), "true");
      await snap(A, "ada-sheet-everyone");
    });

    await t.test("3 Only people added, then Bea as Can edit and Cal as Can view", async () => {
      await A.getByTestId("share-audience-pick-added").click();
      await A.waitForFunction(() => document.querySelector('[data-testid="share-audience-pick-added"]')?.getAttribute("aria-selected") === "true");
      for (const [who, level] of [[bea, "Can edit"], [cal, "Can view"]] as const) {
        await A.getByTestId("share-add").click();
        await A.getByText(who.name, { exact: true }).last().click();
        await A.getByRole("button", { name: new RegExp(`Level for ${who.name}`) }).waitFor();
        if (level !== "Can view") {
          await A.getByRole("button", { name: new RegExp(`Level for ${who.name}`) }).click();
          await A.getByText(level, { exact: true }).last().click();
        }
        await A.getByRole("button", { name: new RegExp(`Level for ${who.name}: ${level}`) }).waitFor();
      }
      await snap(A, "ada-sheet-added");
      const shares = (await api(ada, "access.shares_of", { resource: deal })).shares as Array<{ grant: { subject: { id: string }; level: string }; through: string }>;
      assert.deepEqual(shares.filter((s) => s.through === "direct").map((s) => [s.grant.subject.id, s.grant.level]).sort(), [[bea.id, "edit"], [cal.id, "view"]].sort());
      await A.getByTestId("share-done").click();
      await A.getByTestId("records-share").waitFor({ state: "detached" });
    });

    await t.test("4 Bea edits a deal", async () => {
      await toDeals(B);
      await snap(B, "bea-deals");
      await B.getByTestId(`rec-${deals["Acme renewal"]}`).dblclick();
      await B.getByTestId("record-page").waitFor({ timeout: 20_000 });
      await B.getByTestId("title").click();
      await B.getByTestId("edit-name").fill("Acme renewal 2027");
      await B.getByTestId("edit-name").press("Enter");
      await B.getByText("Acme renewal 2027").first().waitFor({ timeout: 15_000 });
      await snap(B, "bea-edits-a-deal");
      assert.equal((await api(ada, "records.get", { type: "rt_deal", recordId: deals["Acme renewal"] })).record.fields.name, "Acme renewal 2027");
    });

    await t.test("5 Cal sees the deals read only: no Export, no Share, and an edit is refused", async () => {
      await toDeals(C);
      assert.equal(await count(C, "records-export-btn"), 0, "no Export button at all");
      assert.equal(await count(C, "records-share-btn"), 0, "no Share button");
      await C.getByTestId("records-shared").waitFor({ timeout: 15_000 });
      await snap(C, "cal-deals");
      await C.getByTestId(`rec-${deals["Birch lease"]}`).dblclick();
      await C.getByTestId("record-page").waitFor({ timeout: 20_000 });
      assert.equal(await count(C, "record-share-btn"), 0);
      await C.getByTestId("title").click();
      await C.getByTestId("edit-name").fill("Birch lease changed");
      await C.getByTestId("edit-name").press("Enter");
      await C.getByTestId("record-flash").waitFor({ timeout: 15_000 });
      await snap(C, "cal-cannot-edit");
      assert.equal((await api(ada, "records.get", { type: "rt_deal", recordId: deals["Birch lease"] })).record.fields.name, "Birch lease");
      await C.getByTestId("rail-records-selected").click().catch(() => undefined);
      await toDeals(C);
    });

    await t.test("6 Dee, who was not added, has no Deals type at all", async () => {
      await D.getByTestId("rail-records").or(D.getByTestId("rail-records-selected")).first().click();
      await D.getByTestId("records-place").waitFor({ timeout: 20_000 });
      await D.waitForTimeout(800);
      assert.equal(await count(D, "row-nav:type:rt_deal"), 0, "Deals is not in her sidebar");
      assert.equal(await D.getByText("Deals", { exact: true }).count(), 0);
      await snap(D, "dee-no-deals");
    });

    await t.test("7 Ada turns Can export on for Cal; his Export button appears without a refresh and exports only his rows", async () => {
      // one deal is Only me already, so the export has a row Cal cannot see
      await api(ada, "access.audience_set", { resource: { type: "record", id: deals["Dune expansion"] }, audience: "me" });
      await A.getByTestId("records-share-btn").click();
      await A.getByTestId(`share-export-${cal.id}`).waitFor();
      assert.equal(await A.getByTestId(`share-export-${cal.id}`).getAttribute("aria-checked"), "false");
      await A.getByTestId(`share-export-${cal.id}`).click();
      await A.waitForFunction((id: string) => document.querySelector(`[data-testid="share-export-${id}"]`)?.getAttribute("aria-checked") === "true", cal.id);
      await snap(A, "ada-export-for-cal");
      await A.getByTestId("share-done").click();
      await C.getByTestId("records-export-btn").waitFor({ timeout: 20_000 });
      await snap(C, "cal-export-button-appears");
      const exported = C.waitForResponse((r: any) => r.url().includes("/v1/records/export"), { timeout: 20_000 });   // eslint-disable-line @typescript-eslint/no-explicit-any
      await C.getByTestId("records-export-btn").click();
      const answer = await (await exported).json() as { data?: { fileId?: string } };
      await C.getByTestId("records-export-note").filter({ hasText: "Exported" }).waitFor({ timeout: 20_000 });
      await snap(C, "cal-exported");
      const csv = (await api(cal, "files.read", { fileId: answer.data!.fileId, as: "text" })).text as string;
      assert.match(csv, /Acme renewal 2027/);
      assert.match(csv, /Birch lease/);
      assert.match(csv, /Cedar upsell/);
      assert.doesNotMatch(csv, /Dune expansion/, "the deal set to Only me is not in his file");
    });

    await t.test("8 Ada sets one deal to Only me: Bea and Cal lose it at once, without a refresh", async () => {
      assert.ok(await count(B, `rec-${deals["Cedar upsell"]}`) > 0, "Bea has the deal on screen");
      assert.ok(await count(C, `rec-${deals["Cedar upsell"]}`) > 0, "Cal has the deal on screen");
      await A.getByTestId(`rec-${deals["Cedar upsell"]}`).dblclick();
      await A.getByTestId("record-share-btn").waitFor({ timeout: 20_000 });
      await A.getByTestId("record-share-btn").click();
      await A.getByTestId("records-share").waitFor();
      await A.getByTestId("share-override").waitFor();
      await snap(A, "ada-record-follows-the-type");
      await A.getByTestId("share-override").click();
      await A.getByTestId("share-audience-pick-me").click();
      await A.waitForFunction(() => document.querySelector('[data-testid="share-audience-pick-me"]')?.getAttribute("aria-selected") === "true");
      await snap(A, "ada-record-only-me");
      await B.getByTestId(`rec-${deals["Cedar upsell"]}`).waitFor({ state: "detached", timeout: 20_000 });
      await C.getByTestId(`rec-${deals["Cedar upsell"]}`).waitFor({ state: "detached", timeout: 20_000 });
      await snap(B, "bea-lost-the-deal");
      await snap(C, "cal-lost-the-deal");
      assert.equal((await post("records.get", { type: "rt_deal", recordId: deals["Cedar upsell"] }, bea.token)).status, 403);
      // back to following the type: the deal returns to both tables, still without a refresh
      await A.getByTestId("share-audience-pick-space").click();
      await B.getByTestId(`rec-${deals["Cedar upsell"]}`).waitFor({ timeout: 20_000 });
      await C.getByTestId(`rec-${deals["Cedar upsell"]}`).waitFor({ timeout: 20_000 });
      await snap(A, "ada-back-to-the-type");
      await A.getByTestId("share-done").click();
    });

    await t.test("9 the table marks the deals that differ from their type, and Ada's Deals open to everyone again", async () => {
      await A.getByTestId("rail-records-selected").click().catch(() => undefined);
      await toDeals(A);
      assert.ok(await count(A, `mark-${deals["Dune expansion"]}`) > 0, "the lock on the deal set apart");
      await snap(A, "ada-marks");
      await A.getByTestId("records-share-btn").click();
      await A.getByTestId("share-audience-pick-space").click();
      await A.waitForFunction(() => document.querySelector('[data-testid="share-audience-pick-space"]')?.getAttribute("aria-selected") === "true");
      await snap(A, "ada-everyone-again");
      await A.getByTestId("share-done").click();
      await D.getByTestId("row-nav:type:rt_deal").waitFor({ timeout: 20_000 });
      await snap(D, "dee-has-deals-again");
    });

    assert.deepEqual(consoleErrors, [], "no page error in any browser");
  } finally {
    await browser.close();
    web.close();
    await space.stop();
    fs.rmSync(space.dir, { recursive: true, force: true });
  }
});
