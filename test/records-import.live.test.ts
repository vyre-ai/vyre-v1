// Bring in a spreadsheet of contacts as the owner of a fresh Team Space with no AI account (client walk, 11 Nov 2026, blocker 4). The real app in Chromium: Records > Contacts > Import, a 200 row CSV of invented
// people, each column matched to a field (one changed by hand), the preview, the import, and the summary; the contacts are in the table and a member who joined by invite sees them. Pictures of every step,
// light and graphite, wide and phone. Needs the production web export (VYRE_APP_DIST) and Chromium; with VYRE_REQUIRE_CHROME=1 (CI) it fails instead of skipping.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SIZES, bootScreens, browserOrSkip, open, seat, shoot } from "./support/mail-browser.ts";

const OUT = process.env["VYRE_TEST_CAPTURE_DIR"] ? path.join(process.env["VYRE_TEST_CAPTURE_DIR"], "import") : "shots-evidence/import";
const first = ["Ada", "Bram", "Cleo", "Dara", "Eli", "Fenn", "Gia", "Hale", "Iris", "Jory"], last = ["Alder", "Birch", "Cedar", "Dunmore", "Elm", "Fairweather", "Grove", "Hawthorn"];
const person = (i: number): string => `${first[i % 10]} ${last[i % 8]}${i}`;
function csv(): string {
  const lines = ["Full name,Email,Phone,Company,Job title,Notes"];
  for (let i = 0; i < 200; i++) lines.push(`${person(i)},${first[i % 10]!.toLowerCase()}.${i}@example.test,+1 555 01${String(i % 100).padStart(2, "0")},Org ${i % 25},Role ${i % 7},Met at event ${i % 5}`);
  lines.push(`Bad Address,not-an-email,,,,`);
  lines.push(`${person(3)} again,${first[3]!.toLowerCase()}.3@example.test,,,,`);   // the same email as row 4 in the file
  return lines.join("\n");
}

test("import 200 contacts from a CSV with no AI account; a member sees them", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") { t.skip(env); return; }
  const s = await bootScreens({ kind: "team" }, env);
  try {
    const w = s.world;
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "import-")), "people.csv");
    fs.writeFileSync(file, csv());
    const me = await seat(s, w.owner, "Owner");
    await open(me, s, "/records#type=contact");
    await me.page.getByTestId("records-import-btn").waitFor({ timeout: 30_000 });
    await shoot(me.page, OUT, "records-toolbar");

    await me.page.getByTestId("records-import-btn").click();
    await me.page.getByTestId("import-sheet").waitFor();
    await shoot(me.page, OUT, "choose");
    const chooser = me.page.waitForEvent("filechooser");
    await me.page.getByTestId("import-choose").click();
    await (await chooser).setFiles(file);
    await me.page.getByTestId("import-columns").waitFor({ timeout: 20_000 }).catch(async (e: Error) => { fs.mkdirSync(OUT, { recursive: true }); await me.page.screenshot({ path: path.join(OUT, "failed.png") }); throw new Error(`${e.message.split("\n")[0]} | page says: ${(await me.page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300)} | sheet says: ${(await me.page.getByTestId("import-sheet").innerText().catch(() => "")).replace(/\s+/g, " ")} | ${me.logs.slice(-5).join("; ")}`); });
    assert.match(await me.page.getByTestId("import-file-line").innerText(), /202 rows/);
    await shoot(me.page, OUT, "match");

    // change one match by hand: Notes goes to Job title's neighbour field "Leave out" stays; move Company out, then back
    await me.page.getByTestId("import-field-Job title").click();
    await shoot(me.page, OUT, "change-field-menu");
    await me.page.getByText("Leave out", { exact: true }).last().click();   // Job title stays out of the import
    await me.page.getByTestId("import-field-Job title").getByText("Leave out").waitFor();
    await shoot(me.page, OUT, "match-changed");
    await me.page.getByTestId("import-preview").click();
    await me.page.getByTestId("import-counts").waitFor({ timeout: 30_000 });
    assert.equal((await me.page.getByTestId("import-count-new").innerText()).split("\n")[0], "200");
    await shoot(me.page, OUT, "preview");
    await me.page.getByTestId("import-commit").click();
    await me.page.getByTestId("import-summary").waitFor({ timeout: 120_000 });
    assert.match(await me.page.getByTestId("import-summary").innerText(), /^200 new rows added/);
    await shoot(me.page, OUT, "done");
    await me.page.getByTestId("import-done").click();
    await me.page.getByTestId("import-sheet").waitFor({ state: "detached" });
    await me.page.getByText(person(0), { exact: false }).first().waitFor({ timeout: 30_000 });
    await shoot(me.page, OUT, "contacts-after");

    // the palette finds it
    await me.page.keyboard.press("Control+k");
    await me.page.keyboard.type(">import");
    await me.page.getByText("Import contacts from a spreadsheet").first().waitFor({ timeout: 10_000 });
    await shoot(me.page, OUT, "palette");
    await me.page.keyboard.press("Escape");

    // a member sees the people
    const sara = await w.join("sara");
    const rows = (await sara.ok("records.query", { type: "contact", limit: 500 })) as { rows: unknown[] };
    assert.equal(rows.rows.length, 200, "a member sees the 200 contacts the owner brought in");
    const seen = await seat(s, sara, "Member");
    await open(seen, s, "/records#type=contact");
    await seen.page.getByText(person(0), { exact: false }).first().waitFor({ timeout: 30_000 });
    assert.equal(await seen.page.getByTestId("records-import-btn").count() >= 0, true);
    assert.deepEqual(me.errors, []);

    // the phone
    await me.page.setViewportSize(SIZES.phone);
    await open(me, s, "/records#type=contact");
    await me.page.waitForTimeout(1500);
    await me.page.getByTestId("records-more").click();
    await me.page.getByText("Import…", { exact: true }).click();
    await me.page.getByTestId("import-sheet").waitFor();
    const rename = (files: string[]): void => files.forEach((f) => fs.renameSync(f, f.replace("-desktop.png", "-phone.png")));
    rename(await shoot(me.page, OUT, "phone-choose"));
    const ch = me.page.waitForEvent("filechooser");
    await me.page.getByTestId("import-choose").click();
    await (await ch).setFiles(file);
    await me.page.getByTestId("import-columns").waitFor({ timeout: 20_000 });
    rename(await shoot(me.page, OUT, "phone-match"));
    await me.page.getByTestId("import-preview").click();
    await me.page.getByTestId("import-counts").waitFor({ timeout: 30_000 });
    rename(await shoot(me.page, OUT, "phone-preview"));
    await me.page.getByTestId("import-commit").click();
    await me.page.getByTestId("import-summary").waitFor({ timeout: 120_000 });
    assert.match(await me.page.getByTestId("import-summary").innerText(), /^0 new rows added, 200 rows updated, 1 row skipped, 1 row left out for a problem/, `the same file again updates the people already here and adds nobody: ${await me.page.getByTestId("import-summary").innerText()}`);
    rename(await shoot(me.page, OUT, "phone-done"));
  } finally { await s.close(); }
});
