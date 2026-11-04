// /open/<kind>/<id> in a real browser against the production export and a claimed daemon (lane l-chrome2a): a signed-out visitor opens a link, signs in, and lands on the item; a signed-in person
// without access opens a link and sees the peek with Ask for access. Shots (paper, wide and phone) go to VYRE_OPEN_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

const _KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "fixture password 123";

test("/open/<kind>/<id>: signed out, sign in, land on the item; without access, the peek with Ask for access", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST required for production browser evidence"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const shots = process.env["VYRE_OPEN_SHOTS"] ?? "/tmp/vyre-open-shots"; fs.mkdirSync(shots, { recursive: true });
  const SIZES = [["wide", 1280, 800], ["phone", 390, 844]] as const;
  try {
    const owner = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await owner.newPage();
    await page.goto(claimOnEdge(space.claim!, web.origin), { waitUntil: "load" });
    await page.getByTestId("claim-name").fill("Olivia Owner"); await page.getByTestId("claim-username").fill("olivia");
    await page.getByTestId("claim-password").fill(PASSWORD); await page.getByTestId("claim-confirm").fill(PASSWORD);
    await page.getByTestId("claim-next").click(); await page.getByTestId("claim-saved").click(); await page.getByTestId("claim-create").click(); await dismissOnboarding(page);
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);
    const call = async (cap: string, data: unknown, bearer = token): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await owner.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${bearer}` }, data });
      const body = await r.json();
      assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(body)}`);
      return body.data;
    };
    const roles = (await call("access.roles.list", {})).roles as { id: string; name: string }[];
    const inv = await call("members.invites.create", { role: roles.find((r) => r.name === "Member")!.id, idempotencyKey: "inv-maya" });
    // Maya joins through the real join screens, so her account has real keys and the sign-in later is the one a person does
    const joinCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const jp = await joinCtx.newPage();
    const jerrs: string[] = [];
    jp.on("pageerror", (e) => jerrs.push(e.message + " " + (e.stack ?? "").slice(0, 400))); jp.on("console", (m) => { if (m.type() === "error") jerrs.push(m.text().slice(0, 300)); });
    const link = new URL(inv.link);
    await jp.goto(web.origin + link.pathname + link.hash);
    await jp.getByTestId("step-accept").waitFor({ timeout: 20_000 });
    await jp.getByTestId("web").click(); await jp.getByTestId("first").fill("Maya"); await jp.getByTestId("last").fill("Lin"); await jp.getByTestId("next").click();
    await jp.getByTestId("username").fill("maya"); await jp.getByTestId("password").fill(PASSWORD); await jp.getByTestId("confirm").fill(PASSWORD); await jp.getByTestId("next").click();
    await jp.getByTestId("device").fill("Maya's browser"); await jp.getByTestId("next").click();
    await jp.getByTestId("ai-none").click(); await jp.getByTestId("next").click();
    await jp.getByTestId("shell").waitFor({ timeout: 30_000 }).catch(async (e: Error) => {
      const ids = await jp.evaluate(() => [...document.querySelectorAll("[data-testid]")].map((x) => x.getAttribute("data-testid")).slice(0, 30));
      await jp.screenshot({ path: path.join(shots, "debug-join.png") });
      throw new Error(`Maya's join did not reach the shell at ${jp.url()}: ${JSON.stringify(ids)} errors=${JSON.stringify(jerrs.slice(0, 4))}`);
    });
    const maya = { personId: await jp.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].personId as string) };
    await joinCtx.close();
    // two files in two folders the owner made: Maya is given the first, never the second
    const tree = await call("files.tree", {});
    const root = JSON.stringify(tree).match(/"(fld_[a-z0-9]+)"/)![1]!;
    const shared = (await call("files.folder.create", { parentId: root, name: "Shared with Maya", idempotencyKey: "f-shared" })).folder.folderId as string;
    const secret = (await call("files.folder.create", { parentId: root, name: "Owner only", idempotencyKey: "f-secret" })).folder.folderId as string;
    const open = (await call("files.create", { folderId: shared, name: "Rivera engagement letter.md", content: { text: "Dear Elena" }, idempotencyKey: "fl-open" })).file.fileId as string;
    const closed = (await call("files.create", { folderId: secret, name: "Okafor medical summary.md", content: { text: "private" }, idempotencyKey: "fl-closed" })).file.fileId as string;
    await call("access.share", { resource: { type: "folder", id: shared }, subject: { kind: "person", id: maya.personId }, level: "view", idempotencyKey: "share-maya" });

    for (const [size, w, h] of SIZES) {
      // 1. signed out: open the link, sign in, land on the item
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const p = await ctx.newPage();
      const errs: string[] = [];
      p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 300)); });
      await p.goto(`${web.origin}/open/file/${open}`, { waitUntil: "load" });
      await p.getByTestId("si-user").waitFor({ timeout: 20_000 }).catch(async (e: Error) => {
        const ids = await p.evaluate(() => [...document.querySelectorAll("[data-testid]")].map((x) => x.getAttribute("data-testid")).slice(0, 40));
        await p.screenshot({ path: path.join(shots, `debug-signed-out-${size}.png`) });
        throw new Error(`no sign-in form at ${p.url()}: ${JSON.stringify(ids)} / ${e.message.slice(0, 100)}`);
      });
      await p.screenshot({ path: path.join(shots, `open-1-signed-out-${size}-paper.png`) });
      await p.getByTestId("si-user").fill("maya"); await p.getByTestId("si-password").fill(PASSWORD); await p.getByTestId("next").click();
      // the test Space signs people in with stand-in keys, so the lock screen asks once for the password: a person types it and goes on
      const lock = p.getByTestId("lock-password");
      if (await lock.waitFor({ timeout: 15_000 }).then(() => true, () => false)) { await lock.fill(PASSWORD); await lock.press("Enter"); const skip = p.getByTestId("lock-skip"); if (await p.getByTestId("lock-error").innerText().catch(() => "")) await skip.click({ timeout: 5000 }).catch(() => undefined); }
      await p.getByText("Dear Elena").first().waitFor({ timeout: 30_000 }).catch(async (e: Error) => {
        await p.screenshot({ path: path.join(shots, `debug-landed-${size}.png`) });
        throw new Error(`did not land on the file at ${p.url()} errors=${JSON.stringify(errs.slice(0, 5))}: ${(await p.locator("body").innerText()).slice(0, 300)} / ${e.message.slice(0, 80)}`);
      });
      assert.ok(!(await p.getByTestId("open-link-peek").count()), "a person with access sees no peek");
      await p.waitForTimeout(600);
      await p.screenshot({ path: path.join(shots, `open-2-landed-${size}-paper.png`) });
      // 2. signed in, no access: the peek with Ask for access
      await p.goto(`${web.origin}/open/file/${closed}`, { waitUntil: "load" });
      await p.getByTestId("open-link-peek").waitFor({ timeout: 30_000 });
      const text = await p.getByTestId("open-link-peek").innerText();
      assert.match(text, /A file you don't have access to/);
      assert.ok(!text.includes("Okafor"), "the name is never shown");
      await p.waitForTimeout(1200);
      // the hidden file's name is nowhere: not on the page, in the title bar, in a tab, in what the device keeps, or in the Space's recents for this person
      const hidden = ["Okafor", closed];
      const where: Record<string, string> = {
        page: await p.locator("body").innerText(),
        title: await p.title(),
        tabs: (await p.locator("[role=tab]").allInnerTexts()).join(" | "),
        storage: await p.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
        recents: JSON.stringify(await (await ctx.request.post(`${web.origin}/v1/search/recent/list`, { headers: { authorization: `Bearer ${await p.evaluate(() => { const all = JSON.parse(localStorage.getItem("vyre.session.v1")!); return all.sessions[location.origin].token as string; })}` }, data: { limit: 20 } })).json()),
      };
      for (const [w, text] of Object.entries(where)) for (const h of hidden) assert.ok(!text.includes(h), `${h} is in ${w}: ${text.slice(0, 200)}`);
      // the tab beside Chats is the file this same person opened and could open a step earlier, not the hidden one
      if (size === "wide") assert.ok(where["tabs"]!.includes("Rivera engagement"), `the earlier tab: ${where["tabs"]}`);
      else assert.ok(!where["tabs"]!.includes("Rivera"), "a phone has no tab for a file at all");
      await p.screenshot({ path: path.join(shots, `open-3-peek-${size}-paper.png`) });
      await p.getByTestId("open-link-ask").click();
      await p.getByTestId("open-link-asked").waitFor({ timeout: 10_000 });
      await p.screenshot({ path: path.join(shots, `open-4-asked-${size}-paper.png`) });
      await ctx.close();
    }
  } finally { await browser.close(); web.close(); await space.stop(); }
});
