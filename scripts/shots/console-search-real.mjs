#!/usr/bin/env node
// Console, AI use policy, "Web search for agents" in the REAL app: production export, a booted daemon, the owner claimed through the claim link. The walk picks Brave Search, sees the Vault key picker
// appear, creates a Vault item for the key and chooses it, and checks the two Space settings (settings.get) hold the provider and the handle, never a key. Pictures in --out.
// Run on the build box after `node scripts/app-export.mjs`:  node --import tsx scripts/shots/console-search-real.mjs [--dist apps/app/dist] [--out shots-out/console-search-real]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib.mjs";
import { bootFreshSpace, claimOnEdge, dismissOnboarding, edge } from "../../apps/app/tests/real-app-harness.test.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = parseArgs(process.argv.slice(2));
const dist = path.resolve(REPO, args.dist || "apps/app/dist");
const out = path.resolve(REPO, args.out || "shots-out/console-search-real");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let failed = 0;
const say = (ok, line) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${line}`);
  if (!ok) failed += 1;
};
const space = await bootFreshSpace(undefined, true);
const web = await edge(dist, space.url);
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(claimOnEdge(space.claim, web.origin), { waitUntil: "load", timeout: 60000 });
  await page.getByTestId("claim-name").fill("Olivia Owner");
  await page.getByTestId("claim-username").fill("olivia");
  await page.getByTestId("claim-password").fill("correct horse battery 9");
  await page.getByTestId("claim-confirm").fill("correct horse battery 9");
  await page.getByTestId("claim-next").click();
  await page.getByTestId("claim-create").click();
  await page.getByTestId("shell").waitFor({ timeout: 30000 });
  await dismissOnboarding(page).catch(() => false);
  const sess = await page.evaluate(() => localStorage.getItem("vyre.session.v1"));
  const token = JSON.parse(sess).sessions[web.origin].token;
  const api = async (cap, data = {}) => {
    const r = await ctx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, {
      headers: { authorization: `Bearer ${token}` },
      data,
    });
    const text = await r.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: r.status(), body: body?.data ?? body };
  };
  // a Vault item for the key, in a shared folder, so the picker has something to offer
  const folder = await api("vault.folders.create", { idempotencyKey: "cs-f", name: "Keys", scope: "shared" });
  const made = await api("vault.item.put", {
    idempotencyKey: "cs-i",
    folderId: folder.body.folder?.id,
    name: "Brave Search",
    kind: "api_key",
    fields: [{ key: "api_key", value: "BSA-never-shown-123", secret: true }],
  });
  say(made.status === 200, `a Vault item holds the key (${made.status})`);

  await page.goto(`${web.origin}/console#screen=console.page&page=aipolicy`, { waitUntil: "load", timeout: 60000 });
  await page
    .getByText("Web search for agents")
    .first()
    .waitFor({ timeout: 30000 })
    .then(
      () => say(true, "Console, AI use policy shows Web search for agents"),
      () => say(false, "Console, AI use policy shows Web search for agents"),
    );
  await page
    .getByText("Search service")
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await page.screenshot({ path: path.join(out, "1-default.png") });
  say(!(await page.getByText("Vault item for").count()), "no key picker while the default is chosen");
  // choose Brave Search from the menu picker
  await page.getByText("Default (no key)").first().click();
  await page.getByText("Brave Search", { exact: true }).last().click();
  await page
    .getByText("Vault item for Brave Search key")
    .first()
    .waitFor({ timeout: 15000 })
    .then(
      () => say(true, "the Vault item picker appears once a service is chosen"),
      () => say(false, "the Vault item picker appears once a service is chosen"),
    );
  await page.screenshot({ path: path.join(out, "2-brave-chosen.png") });
  const prov = await api("settings.get", { key: "search.provider" });
  say(prov.body?.row?.value === "brave", `search.provider is brave (${JSON.stringify(prov.body?.row?.value)})`);
  // choose the key's Vault item
  await page.getByText("Choose a Vault item or field").first().click();
  await page
    .getByText(/Brave Search · api_key/)
    .first()
    .click()
    .catch(async () => page.getByText("Brave Search", { exact: true }).last().click());
  await sleep(1500);
  const key = await api("settings.get", { key: "search.key" });
  say(
    /^#Brave_Search/.test(String(key.body?.row?.value ?? "")),
    `search.key holds the Vault handle (${JSON.stringify(key.body?.row?.value)})`,
  );
  say(
    !JSON.stringify(key.body).includes("BSA-never-shown-123") &&
      !(await page.content()).includes("BSA-never-shown-123"),
    "the key itself is nowhere in the settings or the page",
  );
  await page.screenshot({ path: path.join(out, "3-key-chosen.png") });
} catch (e) {
  say(false, `walk stopped: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  say(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ")})`);
  await browser.close().catch(() => {});
  await web.close?.();
  await space.stop?.();
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
console.log(failed ? `${failed} FAILED` : "all ok");
process.exit(failed ? 1 : 0);
