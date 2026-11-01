// A step shot four ways for the chat journeys: light and dark, desktop and phone. The phone width draws another shell, so what was open (a sheet, a menu, a route) is gone when the page comes back
// to desktop: `restore` puts it back. A step with typed text and no way to restore it passes `phone: false` and is shot at desktop width only.
import fs from "node:fs";
import path from "node:path";
import { SCHEMES, SIZES, setScheme } from "./mail-browser.ts";

type Page = import("playwright-core").Page;
let n = 0;

export async function shoot(p: Page, dir: string, step: string, o: { phone?: boolean; only?: "desktop" | "phone"; restore?: () => Promise<void> } = {}): Promise<string[]> {
  const out: string[] = [];
  const k = String(++n).padStart(2, "0");
  fs.mkdirSync(dir, { recursive: true });
  for (const [size, vp] of Object.entries(SIZES).filter(([size]) => (o.only !== undefined ? size === o.only : o.phone !== false || size === "desktop"))) {
    for (const scheme of SCHEMES) {
      await setScheme(p, scheme);
      if (p.viewportSize()?.width !== vp.width) { await p.setViewportSize(vp); await p.waitForTimeout(500); }
      await p.waitForTimeout(250);
      const file = path.join(dir, `${k}-${step}-${scheme}-${size}.png`);
      await p.screenshot({ path: file, animations: "disabled" });
      out.push(file);
    }
    if (size === "phone") {
      await p.setViewportSize(SIZES.desktop);
      await p.waitForTimeout(500);
      if (o.restore) await o.restore();
    }
  }
  await setScheme(p, "light");
  return out;
}
