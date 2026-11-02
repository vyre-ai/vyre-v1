// Typing # in a chat offers the person's connected sources first: the company Drive, a SharePoint library and a GitHub repository, each with its provider's mark. A word narrows them, the
// provider's name finds them, a failed read of the mounts leaves the rest with a quiet line, and a pick is linked into the message with its folder id, sent as a lower-case "folder" ref.
import test from "node:test";
import assert from "node:assert/strict";
import { act as reactAct } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { Composer, popupFor } from "../../../../../../ui/src/Composer/index.tsx";
import type { ComposerLists, ComposerSend, PopupEntry, PopupItem } from "../../../../../../ui/src/Composer/index.tsx";
import { MOUNTS_UNREAD, composerSuggest, fetchSuggestions, folderItem } from "./suggest.ts";
import { sendRefs } from "./actions.ts";

const NOW = Date.now();
const mount_ = (o: Record<string, unknown>) => ({ state: "idle", mode: "server_copy", reviewChanges: true, pendingChanges: 0, conflicts: 0, lastSyncAt: NOW - 60_000, ...o });
const MOUNTS = [
  mount_({ mountId: "mnt_drive", folderId: "fld_drive", kind: "google_drive", provider: "Google Drive", name: "My Drive", ref: "0AAbc" }),
  mount_({ mountId: "mnt_sp", folderId: "fld_sp", kind: "sharepoint", provider: "SharePoint", name: "Documents" }),
  mount_({ mountId: "mnt_gh", folderId: "fld_gh", kind: "github", provider: "GitHub", name: "website", ref: "vyre-ai/website" }),
];
const recent = [
  ...[1, 2, 3, 4].map((n) => ({ kind: "record", id: `rec_${n}`, title: `Deal ${n}`, recordType: "deal", score: 1 })),
  ...[1, 2, 3, 4].map((n) => ({ kind: "file", id: `fil_${n}`, title: `Notes ${n}.md`, path: `Personal/Notes ${n}.md`, score: 1 })),
];

/** A member's Space: recent records and files fill two groups, and three sources are mounted. Every call is kept. */
function member(opts: { mountsFail?: boolean } = {}) {
  const calls: string[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push(cap);
    if (cap === "search.recent.list") return { hits: recent };
    if (cap === "search.query") return { hits: recent.filter((h) => h.title.toLowerCase().includes(String((input as { q: string }).q).toLowerCase())) };
    if (cap === "projects.list") return { projects: [] };
    if (cap === "files.folder.search") return { folders: [] };
    if (cap === "mounts.company_drive") return { mounted: [] };
    if (cap === "mounts.list") { if (opts.mountsFail) throw new Error("permission.no_grant"); return { mounts: MOUNTS, total: MOUNTS.length }; }
    return {};
  };
  return { call, calls };
}

const hash = (query: string) => ({ ch: "#" as const, start: 0, end: 1 + query.length, query });
const items = (entries: readonly PopupEntry[]): PopupItem[] => entries.filter((e): e is PopupItem => !("head" in e && e.head !== undefined));
const heads = (entries: readonly PopupEntry[]): string[] => entries.flatMap((e) => ("head" in e && e.head !== undefined ? [e.head] : []));
const sources = (entries: readonly PopupEntry[]): string[] => items(entries).filter((e) => e.data?.["mount"] !== undefined).map((e) => e.label);

test("an empty # shows the company Drive, the SharePoint library and the GitHub repository first, each with its mark", async () => {
  const m = member();
  const lists = await fetchSuggestions({ call: m.call } as never, "#", "");
  const pop = popupFor(hash(""), lists);
  assert.equal(heads(pop)[0], "Folders", "connected sources lead, above recent records and files");
  assert.deepEqual(sources(pop), ["My Drive", "Documents", "website"]);
  assert.deepEqual(items(pop).slice(0, 3).map((e) => e.data?.["brand"]), ["gdrive", "sharepoint", "github"]);
  assert.match(items(pop)[0]!.note ?? "", /^Google Drive · Synced/);
  assert.ok(heads(pop).includes("Records") && heads(pop).includes("Files"), "the rest still shows");
  assert.ok(m.calls.includes("mounts.company_drive"), "the company Drive is asked for, for someone who has not opened Files");
  assert.ok(m.calls.indexOf("mounts.company_drive") < m.calls.indexOf("mounts.list"), "before the mounts are read");
});

test("a word narrows the sources, by name or by provider", async () => {
  const m = member();
  const by = async (q: string): Promise<string[]> => sources(popupFor(hash(q), await fetchSuggestions({ call: m.call } as never, "#", q)));
  assert.deepEqual(await by("google"), ["My Drive"]);
  assert.deepEqual(await by("sharepoint"), ["Documents"]);
  assert.deepEqual(await by("repo"), ["website"]);
  assert.deepEqual(await by("doc"), ["Documents"]);
  assert.deepEqual(await by("zzz"), []);
});

test("a folder found inside a source carries its mark; a git folder says it is a repository", () => {
  const inDrive = folderItem({ folderId: "fld_q", name: "Q4", path: "Personal/My Drive/Q4", fileCount: 0, folderCount: 0, scope: "personal", label: 0, source: { mountId: "mnt_drive", provider: "Google Drive" }, git: false, reviewChanges: false } as never);
  assert.deepEqual(inDrive, { t: "Q4", s: "Google Drive · Personal/My Drive/Q4", kind: "Folder", ref: "fld_q", find: "Google Drive", data: { mount: "mnt_drive", brand: "gdrive" } });
  const repo = folderItem({ folderId: "fld_r", name: "site", path: "Projects/site", fileCount: 0, folderCount: 0, scope: "space", label: 0, git: true, reviewChanges: true } as never);
  assert.equal((repo as { s: string }).s, "Git repository · Projects/site");
});

test("when the mounts cannot be read, the rest shows with a quiet line, not nothing", async () => {
  const m = member({ mountsFail: true });
  const lists = await fetchSuggestions({ call: m.call } as never, "#", "");
  assert.equal(lists.notice, MOUNTS_UNREAD);
  const pop = popupFor(hash(""), lists);
  assert.deepEqual(heads(pop), ["Records", "Files"]);
  const restore = installDom();
  try {
    const root = await mount(createRoot, <Composer whoWillAnswer="" lead="Intake" suggest={composerSuggest({ call: m.call } as never)} />);
    await focusIn(root);
    await typeInto(find(root, "composer-field"), "#");
    await settle();
    assert.equal(textOf(find(root, "composer-popup-notice")).trim(), MOUNTS_UNREAD);
    assert.match(textOf(find(root, "composer-popup")), /Deal 1/);
  } finally { restore(); }
});

test("picking a source links it into the message with its folder id, sent as a folder ref", async () => {
  const m = member();
  const sent: ComposerSend[] = [];
  const restore = installDom();
  try {
    const root = await mount(createRoot, <Composer whoWillAnswer="" lead="Intake" suggest={composerSuggest({ call: m.call } as never)} onSubmit={(p) => sent.push(p)} />);
    await focusIn(root);
    await typeInto(find(root, "composer-field"), "read #");
    await settle();
    const pop = textOf(find(root, "composer-popup"));
    assert.ok(pop.indexOf("My Drive") < pop.indexOf("Deal 1"), "the sources are on top");
    await keyDown(find(root, "composer-field"), "Enter");
    assert.equal(find(root, "composer-field")!.props.value, "read #My Drive ");
    assert.equal(find(root, "composer-chip-folder"), null, "a chat has no folder chip: the source is linked, not dropped");
    await press(find(root, "composer-send"));
  } finally { restore(); }
  assert.deepEqual(sent[0]!.refs, [{ kind: "Folder", id: "fld_drive", title: "My Drive", token: "#" }]);
  assert.deepEqual(sendRefs(sent[0]!), [{ kind: "folder", id: "fld_drive", title: "My Drive" }], "the chat sends the subject type that opens it in Files and names it to the agent");
});

test("a list without sources keeps the old group order", () => {
  const lists: ComposerLists = { records: [{ t: "Deal", kind: "Record", ref: "rec_1" }], folders: [{ t: "Clients", kind: "Folder", ref: "fld_1" }] };
  assert.deepEqual(heads(popupFor(hash(""), lists)), ["Records", "Folders"]);
});

async function focusIn(root: Node): Promise<void> {
  const field = find(root, "composer-field");
  await reactAct(async () => { (field!.props.onFocus as (e: unknown) => void)({ nativeEvent: {}, target: {} }); });
}
async function keyDown(n: Node | null, k: string): Promise<void> {
  const e = { key: k, nativeEvent: { key: k }, target: {}, stopPropagation() {}, preventDefault() {}, isDefaultPrevented: () => false };
  await reactAct(async () => { (n!.props.onKeyDown as (e: unknown) => void)(e); });
}
/** The composer asks a moment after the words change (150 ms), then the answer lands. */
async function settle(): Promise<void> {
  await reactAct(async () => { await new Promise((r) => setTimeout(r, 220)); });
  await flush();
}
