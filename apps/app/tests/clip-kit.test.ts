// A walk helper (K7, 13 Nov 2026): which pieces of text a person sees are cut off. Compares each text element's scroll size with its client size inside the given roots. A menu entry, a slash command row or any
// row that shows dots with no way to read the rest fails here. Named *-kit.test.ts so the layer rules accept it under tests/ (B6).
import type { Page } from "playwright-core";

/** The texts that are clipped inside every element matching `rootSelector`: "<testid or tag>: <text>". Empty when nothing is cut. */
export async function clippedText(page: Page, rootSelector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    for (const root of Array.from(document.querySelectorAll(sel))) {
      for (const el of [root, ...Array.from(root.querySelectorAll("*"))] as HTMLElement[]) {
        const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
        if (!own) continue;
        const cs = getComputedStyle(el);
        // a line clamp shows its whole text unless the text is taller than the clamp; the plain one-line clip shows it unless wider
        if (el.scrollWidth > el.clientWidth + 1 || (cs.overflow !== "visible" && el.scrollHeight > el.clientHeight + 1)) out.push(`${root.getAttribute("data-testid") ?? root.tagName}: ${(el.textContent ?? "").trim().slice(0, 80)}`);
      }
    }
    return out;
  }, rootSelector);
}
