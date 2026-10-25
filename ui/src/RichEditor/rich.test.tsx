// ui/RichEditor: two editors converge through Yjs, markdown round-trips, cursors travel, the WebView bridge keeps the page and the app current (spec 2.16, ARCH 5.6, R6). Run on the regenerated lockfile.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Awareness,
  RichEditor,
  TOOLBAR,
  TOOL_ICONS,
  Y,
  blocksToFragment,
  bridgeHtml,
  connectBridge,
  connectDocs,
  decodeBridge,
  defaultEngine,
  dropAwareness,
  encodeBridge,
  exportMarkdown,
  fragmentToBlocks,
  frozenRichEditorProps,
  fromBase64,
  importMarkdown,
  locateOffset,
  modeFlags,
  parseInline,
  parseMarkdown,
  remoteCursors,
  renderInline,
  renderMarkdown,
  sendAwareness,
  setLocalCursor,
  splitRunsAt,
  toBase64,
} from "./index.tsx";

const SAMPLE = [
  "# Intake notes",
  "",
  "Elena sent the **signed** letter and a *short* note with `code` and a [link](https://example.com/a).",
  "",
  "- first item",
  "- second item",
  "",
  "1. step one",
  "2. step two",
  "",
  "> Keep the quote",
  "> on two lines",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "---",
  "",
  "Last paragraph with ~~strike~~.",
  "",
].join("\n");

const textOf = (doc: Y.Doc, block: number): Y.XmlText => {
  const el = doc.getXmlFragment("default").get(block) as Y.XmlElement;
  return el.get(0) as Y.XmlText;
};

/* ---------- markdown ---------- */

test("markdown round-trips: parse then render gives the same text", () => {
  assert.equal(renderMarkdown(parseMarkdown(SAMPLE)), SAMPLE);
});

test("blocks carry the structure: headings, lists, quote, code, rule", () => {
  const blocks = parseMarkdown(SAMPLE);
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "paragraph", "bulletList", "orderedList", "blockquote", "codeBlock", "horizontalRule", "paragraph"]);
  const code = blocks[5];
  assert.ok(code !== undefined && code.type === "codeBlock");
  if (code !== undefined && code.type === "codeBlock") { assert.equal(code.lang, "ts"); assert.equal(code.text, "const x = 1;"); }
  const list = blocks[2];
  assert.ok(list !== undefined && list.type === "bulletList" && list.items.length === 2);
});

test("inline marks parse and render, nested marks and escapes included", () => {
  const runs = parseInline("a **bold *and italic*** b `c*d` [t](https://x.y)");
  assert.deepEqual(runs.map((r) => [r.text, [...r.marks].sort().join("+")]), [
    ["a ", ""], ["bold ", "bold"], ["and italic", "bold+italic"], [" b ", ""], ["c*d", "code"], [" ", ""], ["t", "link"],
  ]);
  assert.equal(runs[6]?.href, "https://x.y");
  assert.equal(renderInline(parseInline("**bold** and *it*")), "**bold** and *it*");
  assert.equal(renderInline(parseInline("a \\* star")), "a \\* star");
  assert.equal(parseInline("snake_case_name")[0]?.text, "snake_case_name", "underscores inside a word stay text");
});

test("markdown goes into a Yjs document and comes back the same", () => {
  const doc = new Y.Doc();
  importMarkdown(doc, SAMPLE);
  assert.equal(exportMarkdown(doc), SAMPLE);
  const frag = doc.getXmlFragment("default");
  assert.equal((frag.get(0) as Y.XmlElement).nodeName, "heading");
  assert.equal((frag.get(0) as Y.XmlElement).getAttribute("level"), 1);
  assert.equal((frag.get(2) as Y.XmlElement).nodeName, "bulletList");
  assert.equal(((frag.get(2) as Y.XmlElement).get(0) as Y.XmlElement).nodeName, "listItem");
  const delta = textOf(doc, 1).toDelta() as { insert: string; attributes?: Record<string, unknown> }[];
  assert.ok(delta.some((d) => d.insert === "signed" && d.attributes?.["bold"] !== undefined), "marks are Yjs text attributes, as y-prosemirror writes them");
  assert.ok(delta.some((d) => d.attributes?.["link"] !== undefined));
});

test("the fragment reads back as blocks, and an empty document is an empty list", () => {
  const doc = new Y.Doc();
  assert.deepEqual(fragmentToBlocks(doc), []);
  blocksToFragment(doc, parseMarkdown("one\n\ntwo"));
  assert.equal(fragmentToBlocks(doc).length, 2);
  blocksToFragment(doc, []);
  assert.deepEqual(fragmentToBlocks(doc), []);
});

/* ---------- two editors converge ---------- */

test("two editors typing at once converge to the same document", () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const unlink = connectDocs(a, b);
  importMarkdown(a, "# Plan\n\nHello world");
  assert.equal(exportMarkdown(b), "# Plan\n\nHello world\n");

  unlink();
  textOf(a, 1).insert(0, "Hi. ");
  textOf(b, 1).insert(textOf(b, 1).length, "!!");
  assert.notEqual(exportMarkdown(a), exportMarkdown(b), "offline edits differ until they meet");
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  assert.equal(exportMarkdown(a), exportMarkdown(b));
  assert.equal(exportMarkdown(a), "# Plan\n\nHi. Hello world!!\n");
  assert.deepEqual(Y.encodeStateVector(a), Y.encodeStateVector(b));
});

test("live linked editors stay equal through many interleaved edits, formatting included", () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  connectDocs(a, b);
  importMarkdown(a, "alpha beta gamma");
  for (let i = 0; i < 20; i++) {
    const [x, y] = i % 2 === 0 ? [a, b] : [b, a];
    textOf(x, 0).insert(0, `${i},`);
    textOf(y, 0).insert(textOf(y, 0).length, ".");
  }
  textOf(b, 0).format(0, 3, { bold: {} });
  assert.equal(exportMarkdown(a), exportMarkdown(b));
  assert.match(exportMarkdown(a), /^\*\*19,\*\*|^\*\*19\*\*/);
  assert.equal(textOf(a, 0).toString(), textOf(b, 0).toString());
});

test("a late editor catches up from the whole state", () => {
  const a = new Y.Doc();
  importMarkdown(a, SAMPLE);
  const late = new Y.Doc();
  Y.applyUpdate(late, Y.encodeStateAsUpdate(a));
  assert.equal(exportMarkdown(late), SAMPLE);
});

/* ---------- cursors ---------- */

test("each editor sees the other's cursor with its name and colour, and loses it when the other leaves", () => {
  const a = new Awareness(new Y.Doc());
  const b = new Awareness(new Y.Doc());
  try {
    setLocalCursor(a, { name: "Maya Chen", color: "#e8590c" }, 12);
    setLocalCursor(b, { name: "Omar Haddad", color: "#2f9e44" }, 3, 8);
    sendAwareness(a, b);
    sendAwareness(b, a);
    assert.deepEqual(remoteCursors(b).map((c) => [c.name, c.color, c.anchor, c.head]), [["Maya Chen", "#e8590c", 12, 12]]);
    assert.deepEqual(remoteCursors(a).map((c) => [c.name, c.anchor, c.head]), [["Omar Haddad", 3, 8]]);
    dropAwareness(b, [a.clientID]);
    assert.deepEqual(remoteCursors(b), []);
  } finally {
    a.destroy();
    b.destroy();
  }
});

/* ---------- the WebView bridge ---------- */

test("base64 round-trips every length", () => {
  for (let n = 0; n < 12; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
    assert.deepEqual([...fromBase64(toBase64(bytes))], [...bytes]);
  }
  assert.equal(toBase64(new TextEncoder().encode("Man")), "TWFu");
});

test("the bridge drops anything that is not a known message", () => {
  assert.deepEqual(decodeBridge(encodeBridge({ t: "hello" })), { t: "hello" });
  assert.deepEqual(decodeBridge(encodeBridge({ t: "mode", mode: "read" })), { t: "mode", mode: "read" });
  assert.equal(decodeBridge("not json"), null);
  assert.equal(decodeBridge(JSON.stringify({ t: "update" })), null);
  assert.equal(decodeBridge(JSON.stringify({ t: "mode", mode: "root" })), null);
  assert.equal(decodeBridge(42), null);
});

test("the page says hello, the app answers with the document, and edits flow both ways", () => {
  const appDoc = new Y.Doc();
  const pageDoc = new Y.Doc();
  const appAware = new Awareness(appDoc);
  const pageAware = new Awareness(pageDoc);
  try {
    importMarkdown(appDoc, "# Title\n\nBody text");
    let app: ReturnType<typeof connectBridge> | undefined;
    const queue: string[] = [];
    const page = connectBridge(pageDoc, pageAware, (raw) => { queue.push(raw); }, false);
    app = connectBridge(appDoc, appAware, (raw) => page.receive(raw), true);
    for (const raw of queue.splice(0)) app.receive(raw);
    assert.equal(exportMarkdown(pageDoc), "# Title\n\nBody text\n", "the page got the whole document");

    textOf(pageDoc, 1).insert(0, "Edited on the phone. ");
    for (const raw of queue.splice(0)) app.receive(raw);
    assert.equal(exportMarkdown(appDoc), exportMarkdown(pageDoc));
    assert.match(exportMarkdown(appDoc), /Edited on the phone\. Body text/);

    textOf(appDoc, 1).insert(textOf(appDoc, 1).length, " Then the app.");
    assert.match(exportMarkdown(pageDoc), /Then the app\.$/m);

    setLocalCursor(pageAware, { name: "Phone", color: "#1c7ed6" }, 4);
    for (const raw of queue.splice(0)) app.receive(raw);
    assert.deepEqual(remoteCursors(appAware).map((c) => c.name), ["Phone"]);
    page.destroy();
    app.destroy();
  } finally {
    appAware.destroy();
    pageAware.destroy();
  }
});

test("the WebView page embeds the bundle safely and carries the skin tokens", () => {
  const html = bridgeHtml("window.x = '</script><b>';", { win: "#fff", ink: "#111", accent: "#44f" });
  assert.match(html, /<div id="editor">/);
  assert.match(html, /background:#fff/);
  assert.doesNotMatch(html, /<\/script><b>/, "a closing script tag inside the bundle cannot end the script early");
});

/* ---------- the views ---------- */

const base = { ...frozenRichEditorProps, density: "regular" as const, engine: "static" as const };

test("the static view draws the blocks and both remote cursors with their names", () => {
  const doc = new Y.Doc();
  importMarkdown(doc, "# Plan\n\nHello world");
  const aw = new Awareness(doc);
  const peer1 = new Awareness(new Y.Doc());
  const peer2 = new Awareness(new Y.Doc());
  try {
    setLocalCursor(peer1, { name: "Maya Chen", color: "#e8590c" }, 11);
    setLocalCursor(peer2, { name: "Omar Haddad", color: "#2f9e44" }, 14);
    sendAwareness(peer1, aw);
    sendAwareness(peer2, aw);
    const html = renderToStaticMarkup(<RichEditor {...base} mode="edit" markdown="" doc={doc} awareness={aw} />);
    assert.match(html, /Plan/);
    assert.match(html, /Hello world|Hello/);
    assert.match(html, /aria-label="Maya Chen&#x27;s cursor"|aria-label="Maya Chen's cursor"/);
    assert.match(html, /aria-label="Omar Haddad&#x27;s cursor"|aria-label="Omar Haddad's cursor"/);
    assert.match(html, /data-testid="richeditor-peers"/);
  } finally {
    aw.destroy();
    peer1.destroy();
    peer2.destroy();
  }
});

test("markdown seeds an empty document; an empty one shows the placeholder", () => {
  const seeded = renderToStaticMarkup(<RichEditor {...base} mode="edit" markdown={"## Seeded\n\n- one"} />);
  assert.match(seeded, /Seeded/);
  assert.match(seeded, /one/);
  const empty = renderToStaticMarkup(<RichEditor {...base} mode="edit" markdown="" placeholder="Write something" />);
  assert.match(empty, /data-testid="richeditor-empty"/);
  assert.match(empty, /Write something/);
});

test("edit mode has the formatting toolbar; read mode has none and says Read only; suggest says Suggesting", () => {
  const edit = renderToStaticMarkup(<RichEditor {...base} mode="edit" markdown="x" />);
  assert.match(edit, /data-testid="richeditor-toolbar"/);
  for (const c of TOOLBAR) assert.match(edit, new RegExp(`aria-label="${c.label}"`));
  assert.match(edit, /Editing/);
  const read = renderToStaticMarkup(<RichEditor {...base} mode="read" markdown="x" />);
  assert.doesNotMatch(read, /data-testid="richeditor-toolbar"/);
  assert.match(read, /Read only/);
  const suggest = renderToStaticMarkup(<RichEditor {...base} mode="suggest" markdown="x" />);
  assert.match(suggest, /Suggesting/);
});

test("mode flags, engine choice, and cursor placement", () => {
  assert.deepEqual(modeFlags("read"), { editable: false, suggesting: false, label: "Read only" });
  assert.equal(modeFlags("suggest").suggesting, true);
  assert.equal(defaultEngine("edit", "web", false), "tiptap");
  assert.equal(defaultEngine("read", "web", false), "static");
  assert.equal(defaultEngine("edit", "ios", true), "webview");
  assert.equal(defaultEngine("edit", "ios", false), "static", "the phone needs the editor bundle; without it the document is shown, not faked");
  const blocks = parseMarkdown("ab\n\ncd ef");
  assert.deepEqual(locateOffset(blocks, 1), { block: 0, col: 1 });
  assert.deepEqual(locateOffset(blocks, 3), { block: 1, col: 0 });
  assert.deepEqual(locateOffset(blocks, 6), { block: 1, col: 3 });
  const runs = parseInline("hello **big** world");
  const cut = splitRunsAt(runs, 8);
  assert.equal(cut.before.map((r) => r.text).join(""), "hello bi");
  assert.equal(cut.after.map((r) => r.text).join(""), "g world");
});

test("the note header shows the file mark, name, path line, version and View and Edit; the toolbar draws icons, not letters", () => {
  const html = renderToStaticMarkup(<RichEditor {...base} mode="edit" markdown="x" header={{ name: "Rivera notes.md", meta: "Projects \u00b7 Docs", version: 3 }} />);
  assert.match(html, /data-testid="richeditor-header"/);
  assert.match(html, /Rivera notes\.md/);
  assert.match(html, /Projects \u00b7 Docs/);
  assert.match(html, /data-testid="richeditor-version"/);
  assert.match(html, /aria-label="View"/);
  assert.match(html, /aria-label="Edit"/);
  assert.match(html, /aria-label="Version history"/);
  for (const c of TOOLBAR) assert.ok(TOOL_ICONS[c.id] !== undefined && TOOL_ICONS[c.id]?.startsWith("<svg"), `${c.id} has a drawn icon`);
  const bold = html.slice(html.indexOf('data-testid="richeditor-tool-bold"'));
  assert.match(bold.slice(0, 600), /<svg/);
  const first = renderToStaticMarkup(<RichEditor {...base} mode="read" markdown="x" header={{ name: "n.md", meta: "m", version: 1 }} />);
  assert.doesNotMatch(first, /richeditor-version/, "no saved mark on the first version");
});
