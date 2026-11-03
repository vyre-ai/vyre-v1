// The page card and the quote as they draw in a chat, photographed in a real Chromium in both skins (VYRE_SHOT_DIR). Skipped where no Chromium is installed, and on a Mac.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRegistry, Text, View } from "react-native";
import { QuoteCard, WebPageCard } from "./webpage.tsx";

const OUT = process.env["VYRE_SHOT_DIR"] ?? path.join(os.tmpdir(), "vyre-chrome-e2e-shots");
const TOKENS = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../../chrome/src/ui/tokens.css"), "utf8");

async function chromium(): Promise<any> {
  if (process.platform === "darwin") return null;
  try { const pw: any = await import("playwright-core"); const c = pw.chromium ?? pw.default?.chromium; const exe = c.executablePath(); return fs.existsSync(exe) ? c : null; } catch { return null; }
}
const found = await chromium();

// A small screenshot of a contact page, drawn as a JPEG in the browser (the extension sends a masked JPEG), with the password field blacked out as the extension leaves it.
const SVG = "data:image/svg+xml;base64," + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#F5F7FB"/><rect width="320" height="22" fill="#fff"/><rect x="10" y="32" width="110" height="150" rx="6" fill="#fff" stroke="#E4E8F0"/><rect x="130" y="32" width="180" height="150" rx="6" fill="#fff" stroke="#E4E8F0"/><rect x="20" y="44" width="70" height="8" rx="2" fill="#1d2433"/><rect x="20" y="120" width="90" height="12" rx="2" fill="#17141F"/><rect x="140" y="44" width="120" height="8" rx="2" fill="#1d2433"/><rect x="140" y="60" width="150" height="5" rx="2" fill="#9AA5B8"/><rect x="140" y="70" width="140" height="5" rx="2" fill="#9AA5B8"/></svg>`).toString("base64");
let SHOT = "";

function Chat() {
  return (
    <View style={{ padding: 24, gap: 10, width: 640, backgroundColor: "var(--win)" as string }}>
      <View style={{ alignItems: "flex-end", gap: 0 }}>
        <View style={{ maxWidth: "85%", backgroundColor: "var(--me)" as string, borderRadius: 18, paddingHorizontal: 15, paddingVertical: 9 }}>
          <Text style={{ color: "var(--ink)" as string, fontSize: 15, lineHeight: 23 }}>What should I say to her before Thursday's call?</Text>
        </View>
        <View style={{ alignSelf: "flex-end", maxWidth: "85%" }}>
          <WebPageCard id="b1" data={{ url: "https://app.gohighlevel.com/v2/location/sales/contacts/c_8812", title: "Marisol Vega · Contacts", shot: SHOT }} />
          <QuoteCard id="q1" data={{ text: "She said her firm loses every lead that comes in after 5 PM, and she wants answers in five minutes.", url: "https://app.gohighlevel.com/v2/location/sales/contacts/c_8812" }} />
        </View>
      </View>
      <WebPageCard id="b2" data={{ url: "https://lu.ma/mla-ai-lab-8", title: "AI Lab 8: Claude for client intake" }} />
    </View>
  );
}

test("the page card and the quote, light and dark", { skip: !found, timeout: 30_000 }, async () => {
  const browser = await found.launch({ headless: true });
  try {
    const maker = await browser.newPage();
    SHOT = await maker.evaluate(async (src: string) => { const img = new Image(); img.src = src; await img.decode(); const c = document.createElement("canvas"); c.width = 320; c.height = 200; c.getContext("2d")!.drawImage(img, 0, 0); return c.toDataURL("image/jpeg", 0.85); }, SVG);
    await maker.close();
    AppRegistry.registerComponent("chat", () => Chat);
    const app = (AppRegistry as any).getApplication("chat", {});
    const html = renderToStaticMarkup(app.element);
    const css = renderToStaticMarkup(app.getStyleElement());
    fs.mkdirSync(OUT, { recursive: true });
    for (const scheme of ["light", "dark"] as const) {
      const page = await browser.newPage({ viewport: { width: 700, height: 360 }, colorScheme: scheme, deviceScaleFactor: 2 });
      await page.setContent(`<!doctype html><html><head><style>${TOKENS}</style>${css}</head><body>${html}</body></html>`);
      assert.equal(await page.locator('[data-testid="webpage-b1-shot"]').count(), 1);
      await page.screenshot({ path: path.join(OUT, `chat-web-page-quote-${scheme}.png`) });
      await page.close();
    }
  } finally { await browser.close(); }
});
