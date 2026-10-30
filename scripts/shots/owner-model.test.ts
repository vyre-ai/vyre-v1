// A row lays out in a real browser engine when the page drops script-made <style> text (the Mac app's CSP with a style nonce): the sheets RN-web builds with insertRule survive, a stylesheet
// injected as text does not. Chromium and WebKit (the Mac app's engine) both render ui/Row in a page that blocks style text.
// VYRE_REQUIRE_BROWSERS=1 (set on the CI job that installs both browsers) turns a missing esbuild or browser into a failure: a skip is not a pass. Without it the test skips locally.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const need = createRequire(import.meta.url);
const REQUIRED = process.env.VYRE_REQUIRE_BROWSERS === "1";
let esbuild: typeof import("esbuild") | null = null;
let pw: typeof import("playwright-core") | null = null;
try { esbuild = need("esbuild"); pw = need("playwright-core"); } catch { /* skipped below */ }

// What the page does to <style>: text set on a style element is ignored, rules inserted into its sheet are kept.
const BLOCK_STYLE_TEXT = `(function(){var d=Object.getOwnPropertyDescriptor(Node.prototype,"textContent");Object.defineProperty(HTMLStyleElement.prototype,"textContent",{configurable:true,get:function(){return d.get.call(this)},set:function(v){if(v&&this.id!=="react-native-stylesheet")return;d.set.call(this,v)}});})()`;

async function page(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-owner-model-"));
  const entry = path.join(dir, "entry.tsx");
  fs.writeFileSync(entry, `import { createRoot } from "react-dom/client";
import { Text, View } from "react-native";
import { Row } from ${JSON.stringify(path.join(REPO, "ui/src/Row/index.tsx"))};
const Circle = () => <View style={{ width: 20, height: 20, borderRadius: 99, borderWidth: 1.5 }} />;
const Btn = () => <View style={{ height: 26, paddingHorizontal: 12, justifyContent: "center" }}><Text>Set up</Text></View>;
createRoot(document.getElementById("root")!).render(<View style={{ width: 640 }}>
  <Row id="plain" title="One line" />
  <Row id="full" title="Connect your AI" note="Claude, ChatGPT or Grok" leading={<Circle />} trailing={<Btn />} />
</View>);`);
  await esbuild!.build({
    entryPoints: [entry], bundle: true, outfile: path.join(dir, "out.js"), platform: "browser", format: "iife", jsx: "automatic", logLevel: "silent",
    alias: { "react-native": path.join(REPO, "node_modules/react-native-web") }, nodePaths: [path.join(REPO, "node_modules")],
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}", global: "window", __DEV__: "false" }, tsconfig: path.join(REPO, "tsconfig.base.json"),
  });
  const html = path.join(dir, "index.html");
  fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><script>${BLOCK_STYLE_TEXT}</script></head><body style="margin:0"><div id="root"></div><script src="./out.js"></script></body></html>`);
  return html;
}

for (const engine of ["chromium", "webkit"] as const) {
  test(`${engine}: a row lays out with style text blocked: flex row, icon beside the text, button on the right, nothing taller than its box`, { skip: !REQUIRED && (esbuild === null || pw === null) }, async (t) => {
    assert.ok(esbuild !== null && pw !== null, "esbuild and playwright-core are installed");
    let browser;
    try { browser = await pw![engine].launch(); } catch (e) { if (REQUIRED) throw e; t.skip(`${engine} is not installed`); return; }
    try {
      const p = await browser.newPage({ viewport: { width: 800, height: 400 } });
      await p.goto(`file://${await page()}`);
      await p.waitForSelector('[data-testid="row-full"]');
      // a string, not a function: the test runner's transform adds helpers a page does not have
      const m = await p.evaluate(`(function () {
        var q = function (id) { return document.querySelector('[data-testid="' + id + '"]'); };
        var row = q("row-full"), lead = q("row-full-leading"), trail = q("row-full-trailing"), cs = getComputedStyle(row);
        var text = row.children[1], r = row.getBoundingClientRect(), l = lead.getBoundingClientRect(), x = text.getBoundingClientRect(), tr = trail.getBoundingClientRect();
        return { display: cs.display, dir: cs.flexDirection, leadRight: l.right, textLeft: x.left, textRight: x.right, trailLeft: tr.left, rowH: r.height, content: row.scrollHeight, plainH: q("row-plain").getBoundingClientRect().height };
      })()`) as { display: string; dir: string; leadRight: number; textLeft: number; textRight: number; trailLeft: number; rowH: number; content: number; plainH: number };
      assert.equal(m.display, "flex");
      assert.equal(m.dir, "row");
      assert.ok(m.leadRight <= m.textLeft + 0.5, "the icon is beside the text, not above it");
      assert.ok(m.textRight <= m.trailLeft + 0.5, "the button is to the right of the text");
      assert.ok(m.content <= m.rowH + 1, "the content fits inside the row");
      assert.ok(m.rowH >= 44 && m.plainH >= 28, "least heights hold");
    } finally { await browser.close(); }
  });
}
