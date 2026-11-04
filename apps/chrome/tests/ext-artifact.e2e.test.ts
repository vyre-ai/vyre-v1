// Opening an artifact link as the signed-in person, in a real headless Chromium with the unpacked extension: a click on https://<space>/a/<id> in another page asks the bridge (artifact.open, as the person), and the
// artifact opens in a new tab at the single-use address the Space gave. When the bridge refuses (signed out, not shared) the link loads as it was going to. The Space's own pages and other links are left alone.
import test from "node:test";
import assert from "node:assert/strict";
import { findChromium, launch, site } from "./e2e/rig.ts";

const found = await findChromium();

test("a click on an artifact link opens it as the person in a new tab; a refusal lets the link load; other links and the Space's own pages are left alone", { skip: !found && "no Chromium on this machine", timeout: 60_000 }, async () => {
  const space = await site({ "/a/sit_abc123": "<!doctype html><title>The web app</title><p>web app</p>", "/a/sit_private": "<!doctype html><title>The web app</title><p>web app</p>", "/pricing": "<!doctype html><title>Pricing</title>" });
  const viewer = await site({ "/x/code1": "<!doctype html><title>Artifact</title><h1>The artifact</h1>" });
  const other = await site({
    "/": `<!doctype html><title>An email</title><main><a id="art" href="${space.url}/a/sit_abc123">Open the report</a> <a id="nope" href="${space.url}/a/sit_private">Private</a> <a id="plain" href="${space.url}/pricing">Pricing</a></main>`,
  });
  const r = await launch(found!, {
    ops: {
      "artifact.open": (input) => {
        if (String(input["url"]).endsWith("sit_private")) throw Object.assign(new Error("That is not shared with you."), { code: "permission.no_grant" });
        return { url: `${viewer.url}/x/code1`, expiresAt: Date.now() + 60_000 };
      },
    },
  });
  try {
    await r.worker.evaluate((u: string) => (globalThis as any).chrome.storage.local.set({ spaces: [{ id: "spc_mla", name: "My Legal Academy", webUrl: u }], activeSpace: "spc_mla" }), space.url);
    const page = await r.context.newPage();
    await page.goto(other.url + "/");
    await new Promise((x) => setTimeout(x, 500));   // the page's script has read which Spaces are ours

    // the artifact link: a new tab at the single-use address; this page stays where it was
    const opened = r.context.waitForEvent("page", { timeout: 8000 });
    await page.click("#art");
    const tab = await opened;
    await tab.waitForLoadState();
    assert.equal(tab.url(), `${viewer.url}/x/code1`);
    assert.equal(await tab.textContent("h1"), "The artifact");
    assert.equal(page.url(), other.url + "/", "the page did not navigate");
    assert.deepEqual(r.callsTo("artifact.open").map((c) => c.input), [{ url: `${space.url}/a/sit_abc123` }], "asked once, with the link only");
    assert.equal(space.hits.length, 0, "the Space's web app was never loaded");
    await tab.close();

    // refused (not shared with this person): the link goes where it was going
    await page.click("#nope");
    await page.waitForURL(`${space.url}/a/sit_private`, { timeout: 8000 });
    assert.equal(r.callsTo("artifact.open").length, 2);
    await page.goBack();
    await new Promise((x) => setTimeout(x, 300));

    // a link into the Space that is not an artifact is never taken over
    await page.click("#plain");
    await page.waitForURL(`${space.url}/pricing`, { timeout: 8000 });
    assert.equal(r.callsTo("artifact.open").length, 2);

    // on the Space's own pages the link is the web app's to handle
    await page.goto(`${space.url}/pricing`);
    await page.evaluate((u: string) => { const a = document.createElement("a"); a.id = "own"; a.href = `${u}/a/sit_abc123`; a.textContent = "own"; document.body.append(a); }, space.url);
    await new Promise((x) => setTimeout(x, 300));
    await page.click("#own");
    await page.waitForURL(`${space.url}/a/sit_abc123`, { timeout: 8000 });
    assert.equal(r.callsTo("artifact.open").length, 2, "no call: the web app routes its own links");
  } finally { await r.close(); await space.close(); await viewer.close(); await other.close(); }
});
