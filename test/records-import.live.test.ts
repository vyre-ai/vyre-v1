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
    await me.page.setViewportSize({ width: 1440, height: 900 });
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
    // 202 rows in the file: 200 new (the later of the two Dara rows is used), 0 updated, 0 left alone, 1 repeat, 1 problem; the button counts what is written
    assert.equal(await me.page.getByTestId("import-file-total").innerText(), "202 rows in the file.");
    assert.deepEqual(await Promise.all(["new", "updated", "left"].map(async (k) => (await me.page.getByTestId(`import-count-${k}`).innerText()).split("\n")[0])), ["200", "0", "0"]);
    assert.equal(await me.page.getByTestId("import-repeats").innerText(), "1 row repeats an earlier one in this file; the later row is used.");
    assert.equal(await me.page.getByTestId("import-problems").innerText(), "1 row has a problem and will not be brought in.");
    assert.equal(await me.page.getByTestId("import-commit").innerText(), "Bring in 200 rows");
    await shoot(me.page, OUT, "preview");
    await me.page.getByTestId("import-commit").click();
    await me.page.getByTestId("import-summary").waitFor({ timeout: 120_000 });
    assert.equal(await me.page.getByTestId("import-summary").innerText(), "200 new rows added, 1 repeated row left out for a later one, 1 row left out for a problem. They are in contacts.");
    await shoot(me.page, OUT, "done");

    // a member sees the people (the owner's sheet stays open meanwhile)
    const sara = await w.join("sara");
    const rows = (await sara.ok("records.query", { type: "contact", limit: 500 })) as { rows: Array<{ fields: Record<string, unknown> }> };
    assert.equal(rows.rows.length, 200, "a member sees the 200 contacts the owner brought in");
    assert.equal(rows.rows.find((r) => r.fields["email"] === "dara.3@example.test")?.fields["name"], `${person(3)} again`, "the later row of the repeat is the one used");
    assert.equal(rows.rows.find((r) => r.fields["email"] === "dara.3@example.test")?.fields["phone"], undefined, "nothing of the earlier Dara row is mixed in");
    const seen = await seat(s, sara, "Member");
    await open(seen, s, "/records#type=contact");
    await seen.page.getByText(person(0), { exact: false }).first().waitFor({ timeout: 30_000 });

    // Undo: asks what it will do, then takes the import back
    await me.page.getByTestId("import-undo").click();
    await me.page.getByTestId("import-undo-ask").waitFor();
    await shoot(me.page, OUT, "undo-ask");
    await me.page.getByTestId("import-undo-go").click();
    await me.page.getByTestId("import-undone").waitFor({ timeout: 120_000 });
    await shoot(me.page, OUT, "undone");
    await me.page.getByTestId("import-done").click();
    await me.page.getByTestId("import-sheet").waitFor({ state: "detached" });
    await me.page.getByText("No contacts yet.").waitFor({ timeout: 30_000 });
    assert.equal(((await sara.ok("records.query", { type: "contact", limit: 500 })) as { rows: unknown[] }).rows.length, 0, "the people are gone for the member too");
    await shoot(me.page, OUT, "contacts-after-undo");

    // the palette finds it
    await me.page.keyboard.press("Control+k");
    await me.page.keyboard.type(">import");
    await me.page.getByText("Import contacts from a spreadsheet").first().waitFor({ timeout: 10_000 });
    await shoot(me.page, OUT, "palette");
    await me.page.keyboard.press("Escape");
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
    assert.match(await me.page.getByTestId("import-summary").innerText(), /^200 new rows added, 1 repeated row left out for a later one, 1 row left out for a problem/, "the undone people are new again");
    rename(await shoot(me.page, OUT, "phone-done"));
    // the toolbar at three widths: the title keeps its room and the least used actions are in More
    await me.page.setViewportSize({ width: 1440, height: 900 });
    await open(me, s, "/records#type=contact");
    await me.page.getByTestId("records-import-btn").waitFor({ timeout: 30_000 });
    await shoot(me.page, OUT, "toolbar-1440");
    for (const width of [1280, 1024]) {
      await me.page.setViewportSize({ width, height: 800 });
      await open(me, s, "/records#type=contact");
      await me.page.getByTestId("records-more").waitFor({ timeout: 30_000 });
      assert.equal(await me.page.getByTestId("records-import-btn").count(), 0, `at ${width} Import is in More`);
      await shoot(me.page, OUT, `toolbar-${width}`);
      if (width === 1280) { await me.page.getByTestId("records-more").click(); await shoot(me.page, OUT, "toolbar-1280-more"); await me.page.keyboard.press("Escape"); }
    }
  } finally { await s.close(); }
});
