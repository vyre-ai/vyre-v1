// @tsx
// A table over every "Copy link" in the app: what each one writes today, and what pasting it into a new tab opens. A copy action that writes a shape the resolver does not know fails here until it is put in the table.
// The sources: share/rows.ts (itemLink, messageLink), places/chats/mounts/artifact-address.ts (plainLink), places/chats/menus/actions-b.ts (vyreLink = vyre://<kind>/<id>), the tab's Copy link (vyre://<place>/<hash>),
// search results (vyre://<kind>/<id>), the table's #subject=record:<id>, the server's redirect of /a/<id>, and the dead tauri addresses older desktop builds copied.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSpaceLink } from "./space-link.ts";
import { itemLink, messageLink } from "../../share/rows.ts";
import { plainLink } from "../../places/chats/mounts/artifact-address.ts";
import { vyreLink } from "../../places/chats/menus/actions-b.ts";
import { runLink } from "../../places/automations/runs/actions.tsx";
import { eventLink } from "../../places/inbox/calendar/eventpane/model.ts";

const BASE = "https://space.example.test";
const O = [BASE];
const subj = (type: string, id: string) => ({ subject: { type, id } });

/** What each copied link opens. `via` names the copy action. */
const OPENS: [via: string, link: string, expect: unknown][] = [
  ["chat header Copy Link, sidebar chat row", itemLink("chat", "thr_1", BASE), subj("thread", "thr_1")],
  ["file viewer Copy Link, share sheets for a file", itemLink("file", "fil_1", BASE), subj("file", "fil_1")],
  ["files-share sheet for a folder", itemLink("folder", "fld_1", BASE), subj("folder", "fld_1")],
  ["notes Copy link", itemLink("note", "not_1", BASE), { screen: "chats.notes", args: { noteId: "not_1" } }],
  ["automation share sheet", itemLink("automation", "aut_1", BASE), subj("automation", "aut_1")],
  ["agent share sheet", itemLink("agent", "agt_1", BASE), subj("agent", "agt_1")],
  ["add-sheet and project page: a person", itemLink("person", "usr_1", BASE), subj("person", "usr_1")],
  ["record share sheet", itemLink("record", "rec_1", BASE), subj("record", "rec_1")],
  ["vault share sheet", itemLink("vault_item", "vlt_1", BASE), { screen: "vault.layout", args: { share: "vlt_1" } }],
  [
    "Copy Link on a message",
    messageLink("thr_1", "msg_1", BASE),
    { subject: { type: "thread", id: "thr_1" }, args: { m: "msg_1" } },
  ],
  ["artifact Copy link (plainLink), Share sheet", plainLink(BASE, "sit_1"), subj("artifact", "sit_1")],
  [
    "the same from an older desktop build (dead tauri address)",
    plainLink("tauri://localhost", "sit_1"),
    subj("artifact", "sit_1"),
  ],
  ["a dead tauri open link", itemLink("chat", "thr_1", "tauri://localhost"), subj("thread", "thr_1")],
  ["a dead windows webview open link", itemLink("file", "fil_1", "https://tauri.localhost"), subj("file", "fil_1")],
  [
    "the table's Copy link (and the server's redirect of /a/<id>)",
    `${BASE}/#subject=record:rec_1`,
    subj("record", "rec_1"),
  ],
  ["the server's redirect of an artifact address", `${BASE}/#subject=artifact:sit_1`, subj("artifact", "sit_1")],
  ["vyreLink (menus/actions-b.ts), a chat", vyreLink("chat", "thr_1"), subj("thread", "thr_1")],
  ["vyreLink, a project (project page and row)", vyreLink("project", "prj_1"), subj("project", "prj_1")],
  ["vyreLink, an automation (automations sidebar)", vyreLink("automation", "aut_1"), subj("automation", "aut_1")],
  ["runLink (automations/runs/actions.tsx)", runLink({ id: "run_1" } as never), subj("run", "run_1")],
  ["eventLink (calendar event pane Copy Link)", eventLink("evt_1"), subj("event", "evt_1")],
  [
    "the main tab's Copy link, built by vyreLink(place, hash)",
    vyreLink("chats", "subject=thread:thr_1"),
    subj("thread", "thr_1"),
  ],
  ["search Copy Link, chat", "vyre://chat/thr_1", subj("thread", "thr_1")],
  ["search Copy Link, record", "vyre://record/rec_1", subj("record", "rec_1")],
  ["search Copy Link, person and agent", "vyre://person/usr_1", subj("person", "usr_1")],
  ["channel row Copy Link", "vyre://channel/chn_1", subj("channel", "chn_1")],
  ["replies and right pane Copy Link", "vyre://thread/thr_1", subj("thread", "thr_1")],
  [
    "a memory line link",
    "vyre://thread/thr_1?m=msg_2",
    { subject: { type: "thread", id: "thr_1" }, args: { m: "msg_2" } },
  ],
  ["automation, run, goal, project rows", "vyre://run/run_1", subj("run", "run_1")],
  ["goal menu", "vyre://goal/gol_1", subj("goal", "gol_1")],
  ["project page and row", "vyre://project/prj_1", subj("project", "prj_1")],
  ["automation sidebar", "vyre://automation/aut_1", subj("automation", "aut_1")],
  ["note", "vyre://note/not_1", { screen: "chats.notes", args: { noteId: "not_1" } }],
  ["a calendar event result", "vyre://event/evt_1", subj("event", "evt_1")],
  [
    "knowledge page Copy link (KnowPage.tsx)",
    "vyre://knowledge/pg_1",
    { screen: "files.knowledge", args: { v: "page", pageId: "pg_1" } },
  ],
  [
    "Console Computers, Copy address on a computer (opens the Computers page)",
    "vyre://machine/srv_1",
    { screen: "console.machines" },
  ],
  ["settings result", "vyre://settings/mail", { screen: "settings.page", args: { page: "mail" } }],
  ["the main tab's Copy link on a chat tab", "vyre://chats/subject=thread:thr_1", subj("thread", "thr_1")],
  [
    "the main tab's Copy link on a record tab",
    "vyre://records/subject=record:rec_1&type=company",
    subj("record", "rec_1"),
  ],
  [
    "the desktop open link",
    `vyre://open?address=${encodeURIComponent(BASE)}&kind=file&id=fil_1`,
    subj("file", "fil_1"),
  ],
];

/** Shapes a copy action writes that no page opens, each with why. A new one is a decision, not a silent null. */
const UNOPENABLE: [via: string, link: string, why: string][] = [
  [
    "the main tab's Copy link on a place with no item",
    "vyre://chats/screen=tasks.my-work",
    "a place or screen address, not a thing",
  ],
];

for (const [via, link, expect] of OPENS) {
  test(`${via}: ${link} opens its thing`, () => {
    assert.deepEqual(resolveSpaceLink(link, O), expect);
  });
}

test("the shapes no page opens are read as text, on purpose", () => {
  for (const [, link] of UNOPENABLE) assert.equal(resolveSpaceLink(link, O), null, link);
});

test("another Space's address is never opened as this Space's", () => {
  assert.equal(resolveSpaceLink(itemLink("chat", "thr_1", "https://elsewhere.example.test"), O), null);
  assert.equal(resolveSpaceLink("https://elsewhere.example.test/#subject=record:rec_1", O), null);
});

// A new writer: found by scanning the sources, not listed by hand. Every file in apps/app/src that writes or reads a vyre:// link, an /open/ address or a #subject= address must be a file this table knows, and every kind
// it writes (vyre://<kind>/, itemLink("<type>"), vyreLink("<kind>"), copyItemLink("<type>")) must open through the resolver, as a vyre:// link and as an /open/ link, or be listed as unopenable with a reason.
const KNOWN_FILES = new Set([
  "apps/app/src/places/automations/runs/actions.tsx",
  "apps/app/src/places/chats/conversation/Conversation.tsx",
  "apps/app/src/places/chats/conversation/data.tsx",
  "apps/app/src/places/chats/memory/data.tsx",
  "apps/app/src/places/chats/menus/actions-b.ts",
  "apps/app/src/places/chats/mounts/RepliesPage.tsx",
  "apps/app/src/places/chats/rightpane/ThreadsTab.tsx",
  "apps/app/src/places/chats/sidebar/ChatsSidebar.tsx",
  "apps/app/src/places/files/memory/KnowPage.tsx",
  "apps/app/src/places/files/memory/data.tsx",
  "apps/app/src/places/inbox/calendar/eventpane/model.ts",
  "apps/app/src/places/records/projectpage/linked/LinkedTab.tsx",
  "apps/app/src/places/records/table/TableView.tsx",
  "apps/app/src/places/settings/data.tsx",
  "apps/app/src/share/rows.ts",
  "apps/app/src/shell/cmdk/gate.ts",
  "apps/app/src/shell/notifications/os-banner.ts",
  "apps/app/src/shell/providers/inbox.tsx",
  "apps/app/src/shell/reach/OpenLink.tsx",
  "apps/app/src/shell/reach/open-link.ts",
  "apps/app/src/shell/reach/space-link.ts",
  "apps/app/src/shell/session/desktop.ts",
  "apps/app/src/shell/session/entry.ts",
  "apps/app/src/startup/update/model.ts",
  "apps/app/src/startup/update/store.ts",
  "apps/app/src/places/chats/mounts/artifact-address.ts",
  "apps/app/src/places/chats/mounts/ArtifactView.tsx",
  "apps/app/src/places/chats/mounts/ArtifactsPage.tsx",
]);
const NO_PAGE = new Set(["settings", "join", "claim", "update", "update-progress", "open"]);

test("every writer of a link is a file this table knows, and every kind a writer writes opens", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|sample|fixture/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(root, "src"));
  const unknownFiles: string[] = [];
  const kinds = new Set<string>();
  for (const f of files) {
    const rel = path.relative(path.resolve(root, "../.."), f).replaceAll(path.sep, "/");
    const src = fs.readFileSync(f, "utf8");
    if (/vyre:\/\/|\/open\/|#subject=|plainLink\(/.test(src) && !KNOWN_FILES.has(rel)) unknownFiles.push(rel);
    for (const m of src.matchAll(/vyre:\/\/([a-z_]+)\//g)) kinds.add(m[1]!);
    for (const m of src.matchAll(/(?:itemLink|copyItemLink|vyreLink)\("([a-z_]+)"/g)) kinds.add(m[1]!);
  }
  assert.deepEqual(
    unknownFiles,
    [],
    "a new file writes or reads a link: add it to KNOWN_FILES here, and its forms to OPENS (and the resolver) or UNOPENABLE",
  );
  const dead: string[] = [];
  for (const k of [...kinds].filter((k) => !NO_PAGE.has(k) && !k.startsWith("update"))) {
    const kind = k === "vault_item" || k === "vault_folder" ? "vault" : k;
    for (const link of [`vyre://${kind}/${kind}_1`, `${BASE}/open/${kind}/${kind}_1`])
      if (resolveSpaceLink(link, O) === null) dead.push(link);
  }
  assert.deepEqual(dead, [], "a kind a writer writes that the resolver does not open");
});
