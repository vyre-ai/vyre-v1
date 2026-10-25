// ui/Terminal: attach renders the scrollback, live frames arrive in order, keys become shell bytes, a selection is copied (spec 2.7, ARCH 7.2).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HOST_NAMES,
  TERMINAL_HOSTS,
  Terminal,
  TerminalBuffer,
  TerminalFeed,
  copySelection,
  gridSize,
  hostMenu,
  inputPayload,
  isClearKey,
  isStarKey,
  keyToData,
  resizePayload,
  selectionToCopy,
  terminalLabel,
} from "./index.tsx";
import type { TerminalProps } from "./index.tsx";

const plain = (b: TerminalBuffer): string[] => b.text().split("\n");

const base: TerminalProps = { sessionId: "ter_1", title: "Rivera dev server", host: "agent", hostLabel: "Intake's computer" };

/* ---------- the VT engine ---------- */

test("lines, carriage return and backspace behave like a terminal", () => {
  const b = new TerminalBuffer();
  b.write("one\r\ntwo\r\n");
  assert.deepEqual(plain(b), ["one", "two", ""]);
  const c = new TerminalBuffer();
  c.write("abc\rX");
  assert.deepEqual(plain(c), ["Xbc"], "a carriage return overwrites from column zero");
  const d = new TerminalBuffer();
  d.write("abc\b\bX");
  assert.deepEqual(plain(d), ["aXc"]);
  const e = new TerminalBuffer();
  e.write("a\tb");
  assert.equal(plain(e)[0], "a       b", "a tab runs to the next stop of eight");
});

test("colours become skin tokens and reset; bold and dim are kept", () => {
  const b = new TerminalBuffer();
  b.write("\x1b[32mok\x1b[0m plain \x1b[1;31mfail\x1b[0m \x1b[2mquiet\x1b[0m");
  const line = b.lines()[0] ?? [];
  assert.deepEqual(line.map((s) => [s.text, s.style.fg ?? "", s.style.bold === true, s.style.dim === true]), [
    ["ok", "ok", false, false],
    [" plain ", "", false, false],
    ["fail", "danger", true, false],
    [" ", "", false, false],
    ["quiet", "", false, true],
  ]);
});

test("clear screen, erase line and unknown sequences", () => {
  const b = new TerminalBuffer();
  b.write("old\r\nolder\r\n\x1b[2J\x1b[Hnew");
  assert.deepEqual(plain(b), ["new"]);
  const c = new TerminalBuffer();
  c.write("progress 10%\r\x1b[Kdone");
  assert.deepEqual(plain(c), ["done"]);
  const d = new TerminalBuffer();
  d.write("a\x1b[?25lb\x1b]0;title\x07c");
  assert.deepEqual(plain(d), ["abc"], "cursor visibility and the window title do not print");
});

test("an escape sequence split across two writes is joined", () => {
  const b = new TerminalBuffer();
  b.write("\x1b[3");
  b.write("1mred\x1b[0m");
  const line = b.lines()[0] ?? [];
  assert.equal(line[0]?.text, "red");
  assert.equal(line[0]?.style.fg, "danger");
});

test("the scrollback keeps the newest lines up to its cap", () => {
  const b = new TerminalBuffer(50);
  for (let i = 0; i < 80; i++) b.write(`line ${i}\r\n`);
  const lines = plain(b);
  assert.equal(lines.length, 50);
  assert.equal(lines[lines.length - 2], "line 79");
  assert.equal(lines[0], "line 31");
  b.clear();
  assert.deepEqual(plain(b), [""]);
});

/* ---------- live frames ---------- */

test("attach: the replay fills the scrollback, then each frame is applied once and in order", () => {
  const feed = new TerminalFeed("$ npm run dev\r\nready on :3000\r\n", new TerminalBuffer(), 0);
  assert.equal(feed.push({ seq: 1, data: "GET / 200\r\n" }), "ok");
  assert.equal(feed.push({ seq: 1, data: "GET / 200\r\n" }), "duplicate");
  assert.equal(feed.push({ seq: 3, data: "late\r\n" }), "gap");
  assert.equal(feed.next(), 2);
  assert.equal(feed.push({ seq: 2, data: "GET /a 200\r\n" }), "ok");
  assert.deepEqual(feed.engine.text().split("\n"), ["$ npm run dev", "ready on :3000", "GET / 200", "GET /a 200", ""]);
});

test("a replay that already holds frames up to a sequence skips them", () => {
  const feed = new TerminalFeed("a\r\n", new TerminalBuffer(), 5);
  assert.equal(feed.push({ seq: 5, data: "again\r\n" }), "duplicate");
  assert.equal(feed.push({ seq: 6, data: "b\r\n" }), "ok");
  assert.equal(feed.engine.text(), "a\nb\n");
});

/* ---------- keys, copy, sizes ---------- */

test("keys become the bytes the shell expects; Cmd shortcuts stay with the app", () => {
  assert.equal(keyToData({ key: "a" }), "a");
  assert.equal(keyToData({ key: "Enter" }), "\r");
  assert.equal(keyToData({ key: "Backspace" }), "\x7f");
  assert.equal(keyToData({ key: "ArrowUp" }), "\x1b[A");
  assert.equal(keyToData({ key: "Tab" }), "\t");
  assert.equal(keyToData({ key: "c", ctrlKey: true }), "\x03", "Ctrl-C interrupts");
  assert.equal(keyToData({ key: "d", ctrlKey: true }), "\x04");
  assert.equal(keyToData({ key: "f", altKey: true }), "\x1bf");
  assert.equal(keyToData({ key: "k", metaKey: true }), null);
  assert.equal(keyToData({ key: "Shift" }), null);
  assert.equal(isClearKey({ key: "k", metaKey: true }), true);
  assert.equal(isClearKey({ key: "l", ctrlKey: true }), true);
  assert.equal(isClearKey({ key: "k" }), false);
  assert.equal(isStarKey({ key: "d", metaKey: true }), true);
});

test("copy on select: the selection is trimmed and written; an empty selection copies nothing", async () => {
  assert.equal(selectionToCopy("  \n"), null);
  assert.equal(selectionToCopy("npm run dev   \nready  \n\n"), "npm run dev\nready");
  const written: string[] = [];
  const copied = await copySelection("ready on :3000   \n", (t) => { written.push(t); });
  assert.equal(copied, "ready on :3000");
  assert.deepEqual(written, ["ready on :3000"]);
  assert.equal(await copySelection("", (t) => { written.push(t); }), null);
  assert.equal(written.length, 1);
});

test("terminal.input and terminal.resize payloads; the grid stays inside the manifest limits", () => {
  assert.deepEqual(inputPayload("ter_1", "ls\r"), { terminalId: "ter_1", data: "ls\r" });
  assert.deepEqual(resizePayload("ter_1", 3, 1000), { terminalId: "ter_1", cols: 20, rows: 200 });
  assert.deepEqual(resizePayload("ter_1", 120.7, 30.2), { terminalId: "ter_1", cols: 120, rows: 30 });
  const g = gridSize(1000, 600);
  assert.ok(g.cols > 100 && g.cols < 140);
  assert.ok(g.rows > 20 && g.rows < 35);
  assert.deepEqual(gridSize(10, 10), { cols: 20, rows: 5 });
});

test("the host menu names the three hosts, checks the current one and marks a locked server", () => {
  assert.deepEqual([...TERMINAL_HOSTS], ["agent", "server", "device"]);
  const picked: string[] = [];
  const menu = hostMenu("agent", true, (h) => picked.push(h));
  const labels = menu.map((e) => ("label" in e ? e.label : ""));
  assert.deepEqual(labels, ["Agent computer", "Space server (locked)", "This computer"]);
  const checks = menu.map((e) => ("checked" in e ? e.checked : undefined));
  assert.deepEqual(checks, [true, false, false]);
  for (const e of menu) if ("onSelect" in e) e.onSelect?.();
  assert.deepEqual(picked, ["agent", "server", "device"]);
  assert.equal(HOST_NAMES.device, "This computer");
  const open = hostMenu("server", false, () => undefined).map((e) => ("label" in e ? e.label : ""));
  assert.deepEqual(open, ["Agent computer", "Space server", "This computer"]);
});

/* ---------- screens ---------- */

test("attach renders the scrollback with its colours and a cursor on the last line", () => {
  const html = renderToStaticMarkup(<Terminal {...base} output={"$ git status\r\nOn branch main\r\n\x1b[31mmodified: forms/rivera-intake.json\x1b[0m\r\n"} />);
  assert.match(html, /data-testid="terminal-ter_1"/);
  assert.match(html, /git status/);
  assert.match(html, /On branch main/);
  assert.match(html, /modified: forms\/rivera-intake\.json/);
  assert.match(html, /color:var\(--danger\)/, "the red span uses the danger token");
  assert.match(html, /data-testid="terminal-cursor"/);
  assert.match(html, /data-testid="terminal-scroll"/);
});

test("the bar shows the host chip for a plain terminal and the status chip for a session", () => {
  const plainHtml = renderToStaticMarkup(<Terminal {...base} title="" />);
  assert.match(plainHtml, /aria-label="Host: Intake&#x27;s computer"|aria-label="Host: Intake's computer"/);
  assert.doesNotMatch(plainHtml, /data-testid="terminal-state"/);
  const running = renderToStaticMarkup(<Terminal {...base} state="running" onStar={() => undefined} />);
  assert.match(running, /data-testid="terminal-state"/);
  assert.match(running, /Rivera dev server/);
  assert.match(running, /running/);
  assert.match(running, /aria-label="Star"/);
  const starred = renderToStaticMarkup(<Terminal {...base} state="running" starred onStar={() => undefined} />);
  assert.match(starred, /aria-label="Remove star"/);
});

test("an exited session shows exited and takes no input; a read-only one says so and draws no cursor", () => {
  const exited = renderToStaticMarkup(<Terminal {...base} state="exited" output={"done\r\n"} />);
  assert.match(exited, /exited/);
  assert.doesNotMatch(exited, /data-testid="terminal-cursor"/);
  const ro = renderToStaticMarkup(<Terminal {...base} state="running" readonly output={"x\r\n"} />);
  assert.match(ro, /read-only, you do not have access/);
  assert.doesNotMatch(ro, /data-testid="terminal-cursor"/);
});

test("a locked server shell asks for access and draws no prompt", () => {
  const html = renderToStaticMarkup(<Terminal {...base} host="server" hostLabel="Space server" locked owner="Maya Chen" fallbackLabel="Intake's computer" output={"secret scrollback\r\n"} />);
  assert.match(html, /The server shell is locked/);
  assert.match(html, /server\.services/);
  assert.match(html, /aria-label="Ask Maya Chen for access"/);
  assert.match(html, /data-testid="terminal-back"/);
  assert.doesNotMatch(html, /data-testid="terminal-scroll"/, "no prompt and no scrollback while locked");
  assert.doesNotMatch(html, /secret scrollback/);
  assert.doesNotMatch(html, /data-testid="terminal-cursor"/);
  const asked = renderToStaticMarkup(<Terminal {...base} host="server" hostLabel="Space server" locked owner="Maya Chen" asked />);
  assert.match(asked, /Asked Maya Chen/);
  assert.match(asked, /aria-disabled="true"/);
  const generic = renderToStaticMarkup(<Terminal {...base} host="server" hostLabel="Space server" locked />);
  assert.match(generic, /aria-label="Ask for access"/);
});

test("Clear and its Cmd-K hint show unless the shell is locked; a note shows at the right of the bar", () => {
  const html = renderToStaticMarkup(<Terminal {...base} note="Copied" />);
  assert.match(html, /aria-label="Clear"/);
  assert.match(html, /⌘K/);
  assert.match(html, /data-testid="terminal-note"/);
  assert.match(html, /Copied/);
  const locked = renderToStaticMarkup(<Terminal {...base} host="server" hostLabel="Space server" locked />);
  assert.doesNotMatch(locked, /aria-label="Clear"/);
});

test("the label falls back to Terminal", () => {
  assert.equal(terminalLabel({ ...base, title: "" }), "Terminal");
  assert.equal(terminalLabel(base), "Rivera dev server");
});
