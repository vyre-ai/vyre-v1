// @tsx
// Nothing blinks (owner, 2 Nov 2026): switching tabs and places never shows a blank frame. On the production export, signed in, every animation frame during a run of switches is sampled: the main sheet always holds
// words, either the next view or the still copy of the last one. Needs VYRE_APP_DIST (the production web export) and a Chromium; without them it skips.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeBundle, wipe } from "../../../client/src/crypto/keys.ts";
import { bootFreshSpace, edge, ownerSession } from "./real-app-harness.test.ts";

const PASSWORD = "correct horse battery staple 9";
/** A sheet with fewer letters than this is a blank frame: the tab strip alone has more than a few. */
export const BLANK_BELOW = 20;

const SAMPLE = `(function(){window.__frames=[];function s(){var m=document.querySelector('[data-testid="sheet-main"]');window.__frames.push(((m&&m.innerText)||'').trim().length);if(window.__sampling!==false)requestAnimationFrame(s)}requestAnimationFrame(s)})()`;
const STOP = `(function(){window.__sampling=false;return window.__frames})()`;

test("switching tabs and places never shows a blank frame", async (t) => {
  const dist = process.env["VYRE_APP_DIST"];
  if (!dist) { t.skip("VYRE_APP_DIST is not set: the shots job runs this after the production export"); return; }
  const pw = await import("playwright-core");
  const chromium = pw.chromium ?? (pw as unknown as { default: typeof pw }).default.chromium;
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  if (!fs.existsSync(exe)) { if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail(`no Chromium at ${exe}`); t.skip("no Chromium on this machine"); return; }
  const space = await bootFreshSpace(undefined, true);
  const web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    const post = async (cap: string, input: unknown, token?: string): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await fetch(`${space.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
      return (await r.json() as { data?: unknown }).data;
    };
    const made = await makeBundle(PASSWORD, "recovery-code-for-the-test", { spaceId: space.space });
    const { personKey, ...keys } = made;
    wipe(personKey);
    const code = decodeURIComponent(new URL(space.claim!).pathname.split("/").pop() ?? "");
    await post("identity.claim_owner", { code, spaceId: space.space, username: "ada", displayName: "Ada Archer", password: PASSWORD, deviceName: "Setup", deviceClass: "desktop", keys });
    const signedIn = await post("identity.sign_in", { username: "ada", password: PASSWORD, deviceName: "Setup", deviceClass: "desktop" });
    const token = signedIn.session.token as string;
    await fetch(`${space.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    const who = await post("identity.whoami", {}, token);
    const marker = (await post("spaces.get", {}, token)).space.fingerprint as string;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript((v: string) => { try { if (!localStorage.getItem("vyre.session.v1")) localStorage.setItem("vyre.session.v1", v); } catch { /* blocked */ } }, JSON.stringify({ sessions: { [web.origin]: { ...ownerSession(space, web.origin), token, personId: who.principal.id, marker, username: "ada" } } }));
    const page = await ctx.newPage();
    await page.goto(`${web.origin}/chat`, { waitUntil: "load" });
    // the Vault's first-run card, then onboarding: both are walked past the way a person does
    await page.getByText("Continue", { exact: true }).click({ timeout: 3_000 }).catch(() => undefined);
    await page.getByTestId("onboarding-close").click({ timeout: 10_000 }).catch(() => undefined);
    await page.reload({ waitUntil: "load" });
    await page.getByText("Continue", { exact: true }).click({ timeout: 2_000 }).catch(() => undefined);
    await page.getByTestId("chats-landing").waitFor({ timeout: 30_000 });
    await page.getByTestId("rail-records").click();
    await page.getByTestId("records-place").waitFor({ timeout: 15_000 });
    await page.getByTestId("rail-files").click();
    await page.getByTestId("files-place").waitFor({ timeout: 15_000 });
    await page.evaluate(SAMPLE);
    for (const name of ["Chats", "Records", "Files", "Chats"]) {
      await page.getByRole("tab", { name }).click();
      await page.waitForTimeout(400);
    }
    const frames = await page.evaluate(STOP) as number[];
    assert.ok(frames.length > 20, `sampled ${frames.length} frames`);
    const blank = frames.filter((n) => n < BLANK_BELOW).length;
    assert.equal(blank, 0, `${blank} blank frames of ${frames.length}`);
  } finally {
    await browser.close();
    web.close();
    await space.stop();
  }
});
