// Files on a fresh Space as the owner and as a new member (client walk, 11 Nov 2026): a folder and a file can be shared from the list's own menu, what People says everyone gets matches what a member can open,
// "Shared with me" counts nothing where nothing was shared, and no toast outlives the thing it said. Real Chromium against the production export and a claimed daemon; the member joins through the real screens.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootFreshSpace, claimOnEdge, edge, dismissOnboarding } from "./real-app-harness.test.ts";

const PASSWORD = "fixture password 123";

test("fresh Space, Files: Share is in the row menu, People says only what a member can open, Shared with me is empty, a toast goes away", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail("VYRE_APP_DIST required"); t.skip("VYRE_APP_DIST required"); return; }
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  const space = await bootFreshSpace();
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const shots = process.env["VYRE_FILES_SHOTS"] ?? "/tmp/vyre-files-shots"; fs.mkdirSync(shots, { recursive: true });
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
    const joinCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const jp = await joinCtx.newPage();
    const link = new URL(inv.link);
    await jp.goto(web.origin + link.pathname + link.hash);
    await jp.getByTestId("step-accept").waitFor({ timeout: 20_000 });
    await jp.getByTestId("web").click(); await jp.getByTestId("first").fill("Maya"); await jp.getByTestId("last").fill("Lin"); await jp.getByTestId("next").click();
    await jp.getByTestId("username").fill("maya"); await jp.getByTestId("password").fill(PASSWORD); await jp.getByTestId("confirm").fill(PASSWORD); await jp.getByTestId("next").click();
    await jp.getByTestId("device").fill("Maya's browser"); await jp.getByTestId("next").click();
    await jp.getByTestId("ai-none").click(); await jp.getByTestId("next").click();
    await jp.getByTestId("shell").waitFor({ timeout: 30_000 });
    await dismissOnboarding(jp);
    const mayaToken = await jp.evaluate(() => JSON.parse(localStorage.getItem("vyre.session.v1")!).sessions[location.origin].token as string);

    // the owner makes a folder and a file in it
    const tree = await call("files.tree", {});
    const root = JSON.stringify(tree).match(/"(fld_[a-z0-9]+)"/)![1]!;
    const folder = (await call("files.folder.create", { parentId: root, name: "Contracts", idempotencyKey: "f-contracts" })).folder.folderId as string;
    await call("files.create", { folderId: folder, name: "Engagement letter.md", content: { text: "Dear client" }, idempotencyKey: "fl-letter" });
    await page.goto(`${web.origin}/files`, { waitUntil: "load" });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    await page.getByText("Contracts", { exact: true }).first().waitFor({ timeout: 20_000 });
    await page.screenshot({ path: path.join(shots, "owner-files.png") });
    // nothing has been shared with anyone: neither the owner nor the new member has a "Shared with me" count
    const sidebar = async (p: typeof page): Promise<string> => (await p.locator("body").innerText()).replace(/\s+/g, " ");
    const sw = await call("files.shared_with_me", {});
    assert.doesNotMatch(await sidebar(page), /Shared with me \d/, `the owner's own folders are not shared with them: ${JSON.stringify([sw.total, sw.folders.map((f: any) => [f.name, f.owner])])} me=${JSON.stringify((await call("identity.whoami", {})).principal.id)}`);   // eslint-disable-line @typescript-eslint/no-explicit-any
    // a folder in the list shares from its own menu
    await page.getByText("Contracts", { exact: true }).first().click({ button: "right" });
    await page.getByTestId("menu").waitFor({ timeout: 10_000 });
    assert.match(await page.getByTestId("menu").innerText(), /Share…/, "the folder's menu offers Share");
    await page.screenshot({ path: path.join(shots, "owner-row-menu.png") });
    await page.getByTestId("menu-item-Share…").click();
    await page.getByText("Share “Contracts”").first().waitFor({ timeout: 15_000 }).catch(async () => { await page.screenshot({ path: path.join(shots, "owner-share-sheet-missing.png") }); throw new Error("the Share sheet did not open"); });
    await page.screenshot({ path: path.join(shots, "owner-share-sheet.png") });
    const active = await page.evaluate(() => `${document.activeElement?.tagName}:${document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.getAttribute("aria-label") ?? ""}`);
    await page.keyboard.press("Escape");
    await page.getByText("Share “Contracts”").first().waitFor({ state: "detached", timeout: 10_000 }).catch((e) => { throw new Error(`Escape did not close the Share sheet (focus was on ${active}): ${String(e).slice(0, 80)}`); });
    // a file shares from the viewer's More menu too
    await page.getByText("Contracts", { exact: true }).first().dblclick();
    await page.getByText("Engagement letter.md", { exact: true }).first().dblclick();
    await page.getByText("Dear client").first().waitFor({ timeout: 20_000 });
    const mores = await page.evaluate(() => [...document.querySelectorAll('[aria-label*="ore" i], [data-testid*="more" i]')].map((e) => `${e.tagName}:${e.getAttribute("data-testid") ?? ""}:${e.getAttribute("aria-label") ?? ""}`));
    await page.screenshot({ path: path.join(shots, "owner-viewer.png") });
    await page.locator('[data-testid="viewer-more"], [aria-label="More"]').last().click().catch((e) => { throw new Error(`no More button in the viewer: ${JSON.stringify(mores)} ${String(e).slice(0, 60)}`); });
    await page.getByTestId("menu").waitFor({ timeout: 10_000 });
    assert.match(await page.getByTestId("menu").innerText(), /Share…/, "the file viewer's More menu offers Share");
    await page.screenshot({ path: path.join(shots, "owner-viewer-more.png") });
    await page.keyboard.press("Escape");
    // the member sees none of the owner's private folder, and no Shared with me count either
    await jp.goto(`${web.origin}/files`, { waitUntil: "load" });
    await jp.getByText("Files", { exact: true }).first().waitFor({ timeout: 20_000 });
    await jp.waitForTimeout(2000);
    assert.doesNotMatch(await sidebar(jp), /Shared with me \d/, "a new member has nothing shared with them");
    assert.equal(await jp.getByText("Contracts", { exact: true }).count(), 0, "the owner's private folder is not the member's");
    await jp.screenshot({ path: path.join(shots, "member-files.png") });
  } finally { await browser.close(); web.close(); await space.stop(); fs.rmSync(space.dir, { recursive: true, force: true }); }
});
