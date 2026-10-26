// Path mapping: the packet lists apps/app/tests/cmdk*.test.tsx, which lanes-check puts outside L9a; the test lives beside the code in apps/app/src/shell/cmdk/.
// P-L9_15: Cmd-K. Local-first merge ordering, prefix routing, type filters, skin preview, the keyboard map, the rendered sheet and the search budgets.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CmdKBody } from "./CmdK.tsx";
import { CmdKController } from "./controller.ts";
import {
  FILTERS, effectiveTypes, filterCounts, groupRows, mergeHits, parseQuery, stepActive,
} from "./model.ts";
import type { Hit } from "./model.ts";
import { ACTIONS, LOCAL_HITS, SERVER_HITS, createSampleData } from "./sample.ts";
import { KEYBOARD_MAP, formatCombo, keyboardRows, matchShortcut } from "../keyboard/map.ts";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Resolves when the server has answered (status done), however loaded the runner is; the 10 s cap only keeps a hang from stalling the suite. */
const answered = (c: CmdKController): Promise<void> => new Promise((resolve, reject) => {
  const stop = setTimeout(() => { off(); reject(new Error("the server answer never arrived")); }, 10_000);
  const off = c.subscribe(() => { if (c.getState().serverStatus === "done") { clearTimeout(stop); off(); resolve(); } });
  if (c.getState().serverStatus === "done") { clearTimeout(stop); off(); resolve(); }
});
const titles = (c: CmdKController): string[] => c.getState().rows.flatMap((r) => (r.type === "hit" ? [r.hit.title] : r.type === "action" ? [r.action.title] : r.type === "skin" ? [r.name] : []));

test("prefixes route to kinds: @ people and agents, # chats and records, / files, > actions", () => {
  assert.deepEqual(parseQuery("@ma"), { prefix: "@", text: "ma", types: ["person", "agent"] });
  assert.deepEqual(parseQuery("  # renewal"), { prefix: "#", text: "renewal", types: ["chat", "channel", "record", "task"] });
  assert.deepEqual(parseQuery("/ref"), { prefix: "/", text: "ref", types: ["file"] });
  assert.deepEqual(parseQuery(">skin"), { prefix: ">", text: "skin", types: null });
  assert.deepEqual(parseQuery("referral @ home"), { prefix: null, text: "referral @ home", types: null });
});

test("a prefix and a type filter together keep only the kinds both allow", () => {
  const at = parseQuery("@x");
  assert.deepEqual(effectiveTypes(at, []), ["person", "agent"]);
  assert.deepEqual(effectiveTypes(at, ["people"]), ["person"]);
  assert.deepEqual(effectiveTypes(at, ["files"]), []);
  assert.deepEqual(effectiveTypes(parseQuery("x"), ["chats", "records"]), ["chat", "channel", "record", "task"]);
  assert.equal(effectiveTypes(parseQuery("x"), []), null);
});

test("merge: local rows keep their order and place; server hits follow, best score first; no duplicates", () => {
  const merged = mergeHits(LOCAL_HITS.filter((h) => /referral/i.test(h.title + (h.snippet ?? ""))), SERVER_HITS);
  const local = LOCAL_HITS.filter((h) => /referral/i.test(h.title + (h.snippet ?? ""))).map((h) => h.id);
  assert.deepEqual(merged.slice(0, local.length).map((h) => h.id), local, "every local row is still first and in order");
  const extra = merged.slice(local.length);
  assert.deepEqual(extra.map((h) => h.id), ["fi_refpolicy", "rec_refpartner", "cn_refer"], "server-only hits by score");
  assert.equal(new Set(merged.map((h) => `${h.kind}:${h.id}`)).size, merged.length, "the record the device and the server both hold shows once");
  assert.match(merged.find((h) => h.id === "rec_reflog")?.snippet ?? "", /Record, 41 rows/, "the device's own row text is kept");
});

test("merge: a server hit only fills a snippet the device row lacks", () => {
  const a: Hit = { kind: "file", id: "f", title: "A", link: "vyre://file/f", score: 1 };
  const b: Hit = { ...a, snippet: "from the server" };
  assert.equal(mergeHits([a], [b])[0]?.snippet, "from the server");
});

test("groups follow a fixed order and each is capped", () => {
  const many: Hit[] = Array.from({ length: 9 }, (_, i) => ({ kind: "file", id: `f${i}`, title: `File ${i}`, link: "x", score: 1 }));
  const rows = groupRows([...many, LOCAL_HITS[0] as Hit], 6);
  assert.deepEqual(rows.filter((r) => r.type === "head").map((r) => r.type === "head" && r.title), ["Agents", "Files"]);
  assert.equal(rows.filter((r) => r.type === "hit").length, 7);
});

test("local results never wait on the server; the server hits merge in when they arrive and the local rows do not move", async () => {
  const { data } = createSampleData({ serverDelayMs: 80 });
  const c = new CmdKController(data);
  c.setRaw("referral");
  const first = titles(c);
  assert.ok(first.includes("Referral fee log") && first.includes("Referral agreement.pdf"), "local rows are drawn in the same task as the keystroke");
  assert.ok(!first.includes("Referral policy 2026.docx"));
  assert.equal(c.getState().serverStatus, "loading");
  await answered(c);
  const after = titles(c);
  assert.equal(c.getState().serverStatus, "done");
  assert.ok(after.includes("Referral policy 2026.docx") && after.includes("#referrals"));
  const filesBefore = first.filter((t) => /\.(pdf|docx)$/.test(t));
  assert.deepEqual(after.filter((t) => filesBefore.includes(t)), filesBefore, "local file rows keep their order");
  c.dispose();
});

/** Polls until the condition holds; the 10 s cap only keeps a hang from stalling the suite. */
const until = async (cond: () => boolean): Promise<void> => {
  const stop = Date.now() + 10_000;
  while (!cond()) { if (Date.now() > stop) throw new Error("condition never held"); await wait(5); }
};

test("a late answer for an older query is dropped", async () => {
  const { data } = createSampleData({});
  // The server answers when the test says so, so the old query's answer is late by construction, however loaded the runner is.
  const answers: { text: string; resolve: () => void }[] = [];
  const gated = { ...data, server: (text: string) => new Promise<readonly Hit[]>((resolve) => { answers.push({ text, resolve: () => resolve(text === "referral" ? SERVER_HITS : []) }); }) };
  const c = new CmdKController(gated);
  c.setRaw("referral");
  await until(() => answers.length === 1);
  c.setRaw("renewal");
  await until(() => answers.length === 2);
  answers[1]!.resolve();
  await answered(c);
  answers[0]!.resolve();
  await wait(30);
  assert.ok(!titles(c).includes("Referral policy 2026.docx"), "the older query's answer did not land");
  assert.equal(c.getState().serverStatus, "done");
  c.dispose();
});

test("offline or device scope searches the replica only and says so", () => {
  const { data } = createSampleData({ online: false });
  const c = new CmdKController(data);
  c.setRaw("referral");
  assert.equal(c.getState().serverStatus, "offline");
  const html = renderToStaticMarkup(<CmdKBody controller={c} autoFocus={false} />);
  assert.match(html, /Offline: results are what this device holds/);
  const phone = new CmdKController(createSampleData({ scope: "device" }).data);
  phone.setRaw("referral");
  assert.match(renderToStaticMarkup(<CmdKBody controller={phone} autoFocus={false} />), /this device only/i);
  c.dispose(); phone.dispose();
});

test("before typing the sheet shows Recent; @ browses people and agents; > lists actions", () => {
  const { data } = createSampleData();
  const c = new CmdKController(data);
  const heads = (): string[] => c.getState().rows.flatMap((r) => (r.type === "head" ? [r.title] : []));
  assert.deepEqual(heads(), ["Recent"]);
  c.setRaw("@");
  assert.deepEqual(heads(), ["Agents", "People"]);
  assert.ok(!titles(c).includes("Referral fee log"));
  c.setRaw(">");
  assert.deepEqual(heads(), ["Actions"]);
  assert.deepEqual(titles(c), ACTIONS.map((a) => a.title));
  c.setRaw(">call");
  assert.deepEqual(titles(c), ["Call Elena"]);
  c.setRaw("zzzz");
  assert.equal(c.getState().rows[0]?.type, "empty");
  c.dispose();
});

test("type filters narrow the results and the menu counts come from everything found", async () => {
  const { data } = createSampleData({ serverDelayMs: 20 });
  const c = new CmdKController(data);
  c.setRaw("referral");
  await answered(c);
  const counts = c.getState().counts;
  assert.equal(counts["files"], 2);
  assert.equal(counts["records"], 2);
  c.toggleFilter("files");
  assert.ok(titles(c).every((t) => /\.(pdf|docx)$/.test(t)));
  assert.equal(c.getState().counts["files"], 2, "the counts do not shrink with the filter");
  c.toggleFilter("records");
  assert.equal(c.getState().rows.filter((r) => r.type === "head").length, 2);
  c.clearFilter();
  assert.ok(titles(c).includes("Referral questions"));
  assert.equal(filterCounts(LOCAL_HITS)["people"], 3);
  assert.equal(FILTERS.length, 10);
  c.dispose();
});

test("arrows skip headings and wrap; Home and End land on the first and last row", () => {
  const rows = groupRows(LOCAL_HITS, 6);
  const first = stepActive(rows, -1, "first");
  assert.equal(rows[first]?.type, "hit");
  const last = stepActive(rows, first, "last");
  assert.equal(stepActive(rows, last, 1), first);
  assert.equal(stepActive(rows, first, -1), last);
  assert.equal(stepActive([], -1, 1), -1);
});

test("Enter opens in place, Cmd-Enter in a new tab, both note the open under Recent; Esc closes", () => {
  const { data, calls } = createSampleData();
  let closed = 0;
  const c = new CmdKController(data, { onClose: () => { closed += 1; } });
  c.setRaw("referral fee");
  c.choose();
  assert.deepEqual(calls.opened, [{ id: "rec_reflog", newTab: false }]);
  assert.deepEqual(calls.recorded, ["rec_reflog"]);
  assert.equal(closed, 1);
  const d = new CmdKController(data);
  d.setRaw("referral agreement");
  d.choose(d.getState().active, true);
  assert.deepEqual(calls.opened[1], { id: "fi_refagr", newTab: true });
  const e = new CmdKController(data, { onClose: () => { closed += 1; } });
  e.close();
  assert.equal(closed, 2);
  c.dispose(); d.dispose(); e.dispose();
});

test("right-click actions: Copy Link copies the item's source link", () => {
  const { data, calls } = createSampleData();
  const c = new CmdKController(data);
  c.setRaw("referral agreement");
  c.copyLink(c.getState().active);
  assert.deepEqual(calls.copied, ["vyre://file/fi_refagr"]);
  c.dispose();
});

test("Switch skin previews each skin as you arrow through; Esc restores yours; Enter keeps one", () => {
  const { data, calls } = createSampleData();
  const c = new CmdKController(data);
  c.setRaw(">");
  const at = c.getState().rows.findIndex((r) => r.type === "action" && r.action.key === "appearance.skin");
  c.hover(at);
  c.choose(at);
  assert.equal(c.getState().raw, "> skin ");
  assert.equal(c.getState().rows.filter((r) => r.type === "skin").length, 13);
  const firstSkin = c.getState().rows[c.getState().active];
  assert.equal(firstSkin?.type, "skin");
  assert.equal(calls.previews.at(-1), firstSkin?.type === "skin" ? firstSkin.id : "");
  c.move(1);
  const second = c.getState().rows[c.getState().active];
  assert.equal(calls.previews.at(-1), second?.type === "skin" ? second.id : "");
  c.close();
  assert.equal(calls.previews.at(-1), null, "Esc ends the preview");
  assert.deepEqual(calls.setSkins, [], "nothing was chosen");
  const k = createSampleData();
  const e = new CmdKController(k.data);
  e.setRaw("> skin");
  e.move(1);
  e.choose();
  assert.equal(k.calls.setSkins.length, 1);
  assert.equal(k.calls.previews.at(-1), null, "the preview ends before the skin is kept");
  c.dispose(); e.dispose();
});

test("keyboard map: Cmd-K, Cmd-T, Cmd-1..9, Shift-Cmd-1..3, Cmd-D, Cmd-Shift-K, Cmd-F, Alt-Down", () => {
  const mac = (e: Parameters<typeof matchShortcut>[0]) => matchShortcut(e, "mac");
  assert.deepEqual(mac({ key: "k", metaKey: true }), { id: "cmdk.open" });
  assert.deepEqual(mac({ key: "K", metaKey: true }), { id: "cmdk.open" });
  assert.equal(matchShortcut({ key: "k", metaKey: true }, "mac", { inTerminal: true }), null, "Cmd-K clears a terminal");
  assert.deepEqual(mac({ key: "t", metaKey: true }), { id: "tab.new" });
  assert.deepEqual(mac({ key: "4", metaKey: true }), { id: "agent.jump", arg: 4 });
  assert.deepEqual(mac({ key: "!", code: "Digit1", metaKey: true, shiftKey: true }), { id: "space.switch", arg: 1 });
  assert.deepEqual(mac({ key: "3", metaKey: true, shiftKey: true }), { id: "space.switch", arg: 3 });
  assert.equal(mac({ key: "4", metaKey: true, shiftKey: true }), null, "only three Spaces");
  assert.deepEqual(mac({ key: "d", metaKey: true }), { id: "star.toggle" });
  assert.deepEqual(mac({ key: "k", metaKey: true, shiftKey: true }), { id: "softphone.open" });
  assert.deepEqual(mac({ key: "f", metaKey: true }), { id: "settings.find" });
  assert.deepEqual(mac({ key: "ArrowDown", altKey: true }), { id: "unread.next" });
  assert.deepEqual(mac({ key: "?", metaKey: true, shiftKey: true }), { id: "report.open" });
  assert.equal(mac({ key: "k" }), null);
  assert.equal(mac({ key: "k", ctrlKey: true }), null, "Ctrl is not Cmd on a Mac");
  assert.deepEqual(matchShortcut({ key: "k", ctrlKey: true }, "other"), { id: "cmdk.open" });
  assert.equal(matchShortcut({ key: "k", metaKey: true }, "other"), null);
});

test("the keyboard map prints for each platform and feeds Settings > Keyboard", () => {
  assert.equal(formatCombo("Cmd-K", "mac"), "⌘K");
  assert.equal(formatCombo("Shift-Cmd-1", "mac"), "⇧⌘1");
  assert.equal(formatCombo("Cmd-Shift-K", "other"), "Ctrl+Shift+K");
  assert.equal(formatCombo("Alt-Down", "mac"), "⌥↓");
  const rows = keyboardRows("mac");
  assert.equal(rows.length, KEYBOARD_MAP.length);
  assert.equal(rows.find((r) => r.id === "agent.jump")?.keys, "⌘1…9");
  assert.ok(new Set(KEYBOARD_MAP.map((s) => s.id)).size === KEYBOARD_MAP.length, "no shortcut id twice");
});

test("the sheet renders the search field, a filter menu button, quiet group headings, shared rows and the hint footer", async () => {
  const { data } = createSampleData({ serverDelayMs: 10 });
  const c = new CmdKController(data);
  c.setRaw("referral");
  await answered(c);
  const html = renderToStaticMarkup(<CmdKBody controller={c} autoFocus={false} />);
  assert.match(html, /data-testid="cmdk-input"/);
  assert.match(html, /data-testid="cmdk-filter"/);
  for (const h of ["Chats", "Records", "Files", "Automations"]) assert.ok(html.includes(`>${h}<`), `group ${h}`);
  assert.match(html, /data-testid="row-hit-file:fi_refpolicy"/, "a server-only hit is a shared Row");
  assert.match(html, /data-testid="row-hit-record:rec_reflog"/);
  assert.equal((html.match(/background-color:var\(--accent\)/g) ?? []).length, 1, "exactly one row carries the accent fill (ruling 82: the palette keeps the prototype's accent-filled selected row)");
  assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1, "and it is the one the option role marks selected");
  assert.match(html, /to move/);
  assert.match(html, /new tab/);
  assert.ok(!/border-radius:999px|pill/i.test(html), "no pill chips");
  c.dispose();
});
