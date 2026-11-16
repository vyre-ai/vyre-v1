// The wide-table rule in a note (16 Nov 2026): a note holding a table of 11 columns and 42 rows gives it the width of the note, on a dark desktop and a light phone, and its first column stays in view while it scrolls
// sideways (a note is edited in place, so its table scrolls the way an Edit table does: the page scrolls it down). Pictures go to VYRE_VIEWER_SHOTS.
import test from "node:test";
import { session } from "./viewers-harness.test.ts";
import { WIDE_MD, WIDE_PARA, assertStuck, assertUsesPane, fit, stuck } from "./files.tables-kit.test.ts";

async function inNote(
  t: { skip(m?: string): void },
  size: { width: number; height: number },
  scheme: "dark" | "light",
  tag: string,
): Promise<void> {
  const s = await session(t, size, scheme);
  if (!s) return;
  const { page, call } = s;
  try {
    const n = await call("notes.create", { title: "Applicants", body: WIDE_MD, idempotencyKey: "tbl-note" });
    const id = n.note.noteId as string;
    await page.goto(`${s.web.origin}/chat#screen=chats.notes`, { waitUntil: "load" });
    // on a phone the Chats list is the first screen: Notes & artifacts is a row at its foot
    if (tag === "phone") await page.getByText("Notes & artifacts", { exact: true }).first().click({ timeout: 30_000 });
    await s.shot(`note-${tag}-grid`);
    await page.getByTestId(`note-${id}`).click({ timeout: 30_000 });
    const sheet = tag === "phone" ? '[data-testid="note-phone-page"]' : '[data-testid="note-dialog"]';
    await page.locator(sheet).waitFor({ timeout: 30_000 });
    await page.locator(`${sheet} p`).filter({ hasText: WIDE_PARA }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await s.shot(`note-${tag}-table`);
    assertUsesPane(await fit(page, sheet), `a note on a ${tag}`, 72);
    assertStuck(await stuck(page, sheet), `a note on a ${tag}`, false);
    await s.shot(`note-${tag}-table-scrolled`);
  } finally {
    await s.close();
  }
}

test("a note holding a wide table on a dark desktop: the table uses the note's width, first column in view", async (t) => {
  await inNote(t, { width: 1440, height: 900 }, "dark", "desktop");
});

test("a note holding a wide table on a light phone: the table uses the note's width, first column in view", async (t) => {
  await inNote(t, { width: 390, height: 844 }, "light", "phone");
});
