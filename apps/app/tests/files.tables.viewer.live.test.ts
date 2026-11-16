// The wide-table rule in the Files viewer (16 Nov 2026, the owner: "it should be wide right if space is available?"): a table of 11 columns and 42 rows uses the width of the pane in View and in Edit, on a desktop
// (dark) and on a phone (light), and its header row and first column stay in view while it scrolls. Pictures go to VYRE_VIEWER_SHOTS.
import test from "node:test";
import { session } from "./viewers-harness.test.ts";
import { WIDE_MD, WIDE_PARA, assertStuck, assertUsesPane, fit, stuck } from "./files.tables-kit.test.ts";

async function walk(
  t: { skip(m?: string): void },
  size: { width: number; height: number },
  scheme: "dark" | "light",
  tag: string,
) {
  const s = await session(t, size, scheme);
  if (!s) return;
  const { page } = s;
  try {
    const f = await s.make("applicants.md", Buffer.from(WIDE_MD), "text/markdown");
    await page.goto(`${s.web.origin}/files#subject=file:${f.file.fileId}`, { waitUntil: "load" });
    await page.getByText(WIDE_PARA).waitFor({ timeout: 30_000 });
    await page.locator('[role="table"][data-testid^="block-"]').first().waitFor({ timeout: 20_000 });
    assertUsesPane(await fit(page, '[data-testid="vw-doc"]'), `${tag} View`);
    await s.shot(`${tag}-view`);
    assertStuck(await stuck(page, '[data-testid="vw-doc"]'), `${tag} View`);
    await s.shot(`${tag}-view-scrolled`);
    await page.getByTestId("vw-mode-edit").click();
    await page.getByTestId("md-table").waitFor({ timeout: 20_000 });
    assertUsesPane(await fit(page, '[data-testid="vw-doc-editor"]'), `${tag} Edit`);
    await s.shot(`${tag}-edit`);
    assertStuck(await stuck(page, '[data-testid="vw-doc-editor"]'), `${tag} Edit`, false);
    await s.shot(`${tag}-edit-scrolled`);
    // the cell's menu, on this table
    await page.getByTestId("md-table-menu-btn").first().dispatchEvent("mousedown");
    await page.getByTestId("md-table-act-row-below").waitFor({ timeout: 10_000 });
    await s.shot(`${tag}-edit-cell-menu`);
  } finally {
    await s.close();
  }
}

test("a wide table uses the pane in View and in Edit on a dark desktop, header and first column in view", async (t) => {
  await walk(t, { width: 1440, height: 900 }, "dark", "desktop");
});

test("a wide table uses the pane in View and in Edit on a light phone, header and first column in view", async (t) => {
  await walk(t, { width: 390, height: 844 }, "light", "phone");
});
