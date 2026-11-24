// The extension's own pages never render page-supplied HTML: a title, a name or a snippet with markup is shown as the text it is.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const walk = (d: string): string[] =>
  fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test("h() puts a page title with markup in as one text node, never as an element, an attribute or a handler", async () => {
  const made: any[] = [];
  const node = (type: number, extra: any = {}) => ({
    nodeType: type,
    children: [] as any[],
    attrs: {} as Record<string, string>,
    ...extra,
  });
  (globalThis as any).document = {
    createElement: (n: string) => {
      const e: any = node(1, { tag: n, style: {}, dataset: {}, className: "" });
      e.appendChild = (c: any) => void e.children.push(c);
      e.setAttribute = (k: string, v: string) => void (e.attrs[k] = v);
      e.addEventListener = () => {};
      made.push(e);
      return e;
    },
    createTextNode: (t: string) => node(3, { text: t }),
  };
  const { h } = await import("../src/ui/dom.js");
  const evil = `<img src=x onerror="alert(1)"><script>steal()</script>Docs & "more"`;
  const el: any = h("div.title", { "aria-label": "x" }, evil);
  assert.equal(el.children.length, 1);
  assert.equal(el.children[0].nodeType, 3, "a text node");
  assert.equal(el.children[0].text, evil, "the words exactly as the page wrote them");
  assert.equal(made.length, 1, "no element was made from the markup");
});

test("no page of the extension parses markup: no innerHTML, outerHTML, insertAdjacentHTML, document.write, DOMParser, srcdoc or createContextualFragment (the icon set's static SVG is the one exception)", () => {
  for (const f of walk(SRC).filter((x) => x.endsWith(".js"))) {
    if (f.endsWith(path.join("ui", "icons.js"))) continue;
    const bare = fs
      .readFileSync(f, "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(
      !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|srcdoc|createContextualFragment|\.setHTML\(/.test(
        bare,
      ),
      `${path.relative(SRC, f)} parses markup`,
    );
  }
});
