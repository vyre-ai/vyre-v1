// "Show Vyre how" in a real headless Chromium with the unpacked extension (tests/e2e/rig.ts): record a fixture flow with real mouse and keyboard, a password never captured, the review page,
// save it as a skill, the share card, and replay the saved script. Screenshots go to VYRE_SHOT_DIR.
import test from "node:test";
import assert from "node:assert/strict";
import { findChromium, launch, site } from "./e2e/rig.ts";
import { parseSkill } from "../../../lib/skill-md.ts";
import { AGENTS, NEW, PORTAL, SECRET, USER, openPanelFor, shootAll } from "./e2e/show-watch.ts";

const found = await findChromium();

test("record a flow with real clicks and typing, a password is never captured, review it, save it as a skill, replay it", { skip: !found, timeout: 60_000 }, async () => {
  const s = await site({ "/portal": PORTAL, "/new": NEW });
  const saved: any[] = [];
  const r = await launch(found!, {
    ops: { "agents.list": AGENTS, "chat.ask": () => ({ threadId: "thr_test", turnId: "msg_1" }), "app.open": () => ({ opened: "app" }) },
    caps: {
      "skills.mine.add": (i) => { saved.push(i); const name = /^name: (.*)$/m.exec(i.text)![1]; return { skill: { skillId: "sko_1", name } }; },
      "skills.mine.set": () => ({ skillId: "sko_1", enabled: true, agents: ["*"], setup: {}, needs: [] }),
      "skills.share": (i) => ({ sharedWith: i.stop ? [] : ["everyone"] }),
    },
  });
  try {
    const page = await r.context.newPage();
    await page.goto(`${s.url}/portal`);
    await page.bringToFront();
    const panel = await openPanelFor(r, s.url);
    await panel.waitForSelector(".ch.pg .t", { timeout: 10_000 });
    // the sheet: More > Show Vyre how
    await panel.click('[data-a="more"]');
    await panel.click("#menu .mi:has-text('Show Vyre how')");
    await panel.waitForSelector("#recname");
    await panel.fill("#recname", "Add a contact to Acme");
    await shootAll(r, panel, "chrome2b-show-sheet");
    await panel.click('[data-a="recStart"]');
    await panel.waitForSelector(".recline");
    await page.waitForSelector("[data-vyre-recbar]", { state: "attached" });
    await shootAll(r, panel, "chrome2b-recording-line");

    // a real person: types the email, goes to the password (a secret field), types it and signs in
    await page.click("#e");
    await page.keyboard.type(USER);
    await page.keyboard.press("Tab");
    await page.keyboard.type(SECRET);
    await page.waitForFunction(() => true);
    await page.screenshot({ path: `${process.env["VYRE_SHOT_DIR"] ?? "/tmp/vyre-chrome-e2e-shots"}/chrome2b-recording-page.png` });
    await Promise.all([page.waitForURL(/\/new/), page.click("button[type=submit]")]);
    await page.waitForSelector("#n");
    await page.click("#n");
    await page.keyboard.type("Daniel Okafor");
    await page.keyboard.press("Tab");
    await page.keyboard.type("dokafor@okaforinjury.com");
    await page.keyboard.press("Tab");
    await page.click("#save");
    assert.match(await page.textContent("#done") ?? "", /Saved Daniel Okafor/);
    await new Promise((x) => setTimeout(x, 600));

    // nothing the person typed into the password field is anywhere the extension keeps things
    const kept = await r.worker.evaluate(async () => JSON.stringify(await (globalThis as any).chrome.storage.session.get(null)));
    assert.equal(kept.includes(SECRET), false, "the password is not in the extension's memory");
    assert.equal(kept.includes(USER), false, "nor is the username that belonged to the sign-in");

    const waitingReview = r.context.waitForEvent("page", { predicate: (p: any) => p.url().includes("/src/review/review.html") });
    await panel.click('[data-a="recStop"]');
    const review = await waitingReview;
    if (process.env["VYRE_E2E_DEBUG"]) review.on("pageerror", (e: any) => console.log("review error:", String(e)));
    await review.setViewportSize({ width: 1440, height: 900 });
    await review.waitForSelector(".rstep");
    const words = await review.$$eval(".rstep .tx", (e) => e.map((x) => x.textContent));
    assert.deepEqual(words, ["Open 127.0.0.1/portal", "Sign in to 127.0.0.1 with Vault", "Type name in \"Name\"", "Type email in \"Email\"", "Click the button \"Save\""]);
    assert.ok(await review.$(".rstep .th img"), "each step has a picture");
    assert.match(await review.textContent(".rstep:nth-child(3) .tag, .rstep .tag") ?? "", /Password not recorded/);

    // the review: mark the last step "ask me first", make the email a fixed value, then save
    await review.hover(".rstep:last-of-type");
    await review.click('.rstep:last-of-type [data-a="ask"]');
    await review.waitForSelector(".tag.warn");
    await review.click('[data-a="mode"][data-key="email"]');
    await review.click("#menu .mi:has-text('Always')");
    await review.waitForSelector('input[data-a="example"][data-key="email"]');
    for (const scheme of ["light", "dark"] as const) {
      await review.emulateMedia({ colorScheme: scheme });
      await review.setViewportSize({ width: 1440, height: 900 });
      await r.shot(review, `chrome2b-review-1440-${scheme === "light" ? "paper" : "graphite"}`);
      await review.setViewportSize({ width: 390, height: 900 });
      await r.shot(review, `chrome2b-review-390-${scheme === "light" ? "paper" : "graphite"}`);
    }
    await review.emulateMedia({ colorScheme: "light" });
    await review.setViewportSize({ width: 1440, height: 900 });
    await review.click('[data-a="save"]');
    await review.waitForSelector(".skc");
    const add = await r.waitFor(() => saved[0], 5000, "skills.mine.add");
    assert.equal(add.source, "chrome:recording");
    assert.ok(add.agents.includes("agt_assist"));
    const parsed = parseSkill(add.text);
    assert.ok(parsed.ok);
    assert.match(add.text, /5\. Click the button "Save" \(ask the person first and wait for yes\)/);
    const replay = JSON.parse(add.files["replay.json"]);
    assert.equal(JSON.stringify(add).includes(SECRET), false, "the skill holds no password");
    assert.deepEqual(replay.steps.map((x: any) => x.tool), ["chrome_open", "vault_signin", "chrome_type", "chrome_type", "chrome_click"]);
    assert.deepEqual([replay.steps[2].input, replay.steps[3].text], ["name", "dokafor@okaforinjury.com"], "the name is asked for each time, the email is fixed");
    await r.shot(review, "chrome2b-review-saved-1440-paper");

    // the share card
    await review.click('[data-a="add"]');
    await r.waitFor(() => r.callsTo("skills.mine.set")[0], 4000, "skills.mine.set");
    assert.deepEqual(r.callsTo("skills.mine.set")[0]!.input, { skillId: "sko_1", enabled: true, agents: ["*"] });
    await review.click('[data-a="try"]');
    await r.waitFor(() => r.callsTo("chat.ask")[0], 4000, "chat.ask");
    assert.match(r.callsTo("chat.ask")[0]!.input.text, /Run the skill "add-a-contact-to-acme"/);
    await review.click('[data-a="share"]');
    await review.click("#menu .mi:has-text('Everyone')");
    await r.waitFor(() => r.callsTo("skills.share")[0], 4000, "skills.share");
    assert.deepEqual(r.callsTo("skills.share")[0]!.input, { skillId: "sko_1", space: true });
    await review.click('[data-a="view"]');
    await r.waitFor(() => r.callsTo("app.open").find((c) => c.input.place === "skill"), 4000, "app.open skill");
    await r.shot(review, "chrome2b-share-card-1440-paper");
    await review.setViewportSize({ width: 390, height: 900 });
    await r.shot(review, "chrome2b-share-card-390-paper");

    // replay: the script runs again on a fresh page. A stand-in for the agent finds each element by its role and name in the page's accessibility tree (as chrome_snapshot refs do),
    // takes the Vault's login for the sign-in step, and asks for the input the step names.
    const again = await r.context.newPage();
    const inputs: Record<string, string> = { name: "Priya Raman" };
    for (const step of replay.steps) {
      if (step.tool === "chrome_open") await again.goto(step.args.url.replace(/^http:\/\/127\.0\.0\.1:\d+/, s.url));
      else if (step.tool === "vault_signin") { await again.getByRole("textbox", { name: "Email" }).fill(USER); await again.locator("input[type=password]").fill(SECRET); await Promise.all([again.waitForURL(/\/new/), again.getByRole("button", { name: "Sign in" }).click()]); }
      else if (step.tool === "chrome_type") await again.getByRole(step.find.role, { name: step.find.name }).fill(step.input ? inputs[step.input]! : step.text);
      else if (step.tool === "chrome_click") { assert.equal(step.askFirst, true); await again.getByRole(step.find.role, { name: step.find.name }).click(); }
    }
    assert.equal(await again.textContent("#done"), "Saved Priya Raman <dokafor@okaforinjury.com>");
  } finally { await r.close(); await s.close(); }
});

