// The shared half of the wide-table walks (16 Nov 2026): the Markdown file with a table wider than any pane, and what is measured in every place that draws one: how much of the pane the table uses, and whether its
// header row and first column stay in view while it scrolls. A helper, not a walk: it is named on a --files line only.
import assert from "node:assert/strict";
import type { Page } from "playwright-core";

const COLS = Array.from({ length: 11 }, (_, i) => `Column ${i + 1}`);
const ROWS = Array.from(
  { length: 42 },
  (_, r) => `| ${COLS.map((_c, c) => `Applicant ${r + 1} value ${c + 1} with some words`).join(" | ")} |`,
);
export const WIDE_PARA = "A short paragraph above the table.";
/** A page of text, a table of 11 columns and 42 rows, and a closing line. */
export const WIDE_MD = `# Applicants\n\n${WIDE_PARA}\n\n| ${COLS.join(" | ")} |\n| ${COLS.map(() => "---").join(" | ")} |\n${ROWS.join("\n")}\n\nA closing paragraph.\n`;

export interface Fit {
  table: number;
  pane: number;
  left: number;
  right: number;
}

/** The table the surface draws (the View table or the Edit table) against the pane it sits in: the pane is the element named by `pane`. */
export async function fit(page: Page, pane: string): Promise<Fit> {
  const m = await page.evaluate((paneSel) => {
    const p = document.querySelector(paneSel) as HTMLElement | null;
    const t = (p ?? document).querySelector(
      '[role="table"][data-testid^="block-"], table.vyre-tbl',
    ) as HTMLElement | null;
    if (!p || !t) return null;
    const pr = p.getBoundingClientRect();
    const tr = t.getBoundingClientRect();
    return { table: tr.width, pane: pr.width, left: tr.left - pr.left, right: pr.right - tr.right };
  }, pane);
  assert.ok(m, `a table inside ${pane}`);
  return m;
}

/** The table uses the pane: it reaches within the page's own side padding of both edges and never goes past either. */
export function assertUsesPane(f: Fit, where: string, pad = 64): void {
  assert.ok(f.left >= -1 && f.right >= -1, `${where}: the table stays inside the pane (${JSON.stringify(f)})`);
  assert.ok(f.left <= pad && f.right <= pad, `${where}: the table uses the pane's width (${JSON.stringify(f)})`);
}

/** Scroll the table sideways and down, then say how far the header row and the first column are from the scroller's own top and left edge: 0 means they stayed in view. */
export async function stuck(page: Page, pane: string): Promise<{ head: number; first: number; moved: boolean }> {
  const r = await page.evaluate((paneSel) => {
    const p = document.querySelector(paneSel) as HTMLElement;
    const t = p.querySelector('[role="table"][data-testid^="block-"], table.vyre-tbl') as HTMLElement;
    const head = (
      t.matches("table") ? t.querySelector("th") : t.querySelector('[data-testid^="thead-"] > *')
    ) as HTMLElement;
    const first = (
      t.matches("table")
        ? t.querySelectorAll("tr")[3]?.querySelector("td")
        : t.querySelector('[data-testid^="cell-"][data-testid$="-2-0"]')
    ) as HTMLElement;
    let sc: HTMLElement | null = first;
    while (sc && !(sc.scrollWidth > sc.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(sc).overflowX)))
      sc = sc.parentElement;
    if (!sc) return null;
    sc.scrollLeft = 260;
    sc.scrollTop = 140;
    const s = sc.getBoundingClientRect();
    return {
      head: head.getBoundingClientRect().top - s.top,
      first: first.getBoundingClientRect().left - s.left,
      moved: sc.scrollLeft > 0 && sc.scrollTop > 0,
    };
  }, pane);
  assert.ok(r, `a scrolling table inside ${pane}`);
  return r;
}

export function assertStuck(s: { head: number; first: number; moved: boolean }, where: string): void {
  assert.ok(s.moved, `${where}: the table scrolled both ways`);
  assert.ok(Math.abs(s.head) <= 2, `${where}: the header row stays at the top (${s.head})`);
  assert.ok(Math.abs(s.first) <= 2, `${where}: the first column stays at the left (${s.first})`);
}
