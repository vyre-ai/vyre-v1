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
  ["knowledge page Copy link", "vyre://knowledge/pg_1", "a knowledge page has no subject route"],
  ["machines list Copy address", "vyre://machine/srv_1", "a machine has no subject route"],
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

// a new copy action: every vyre://<kind>/ literal and every itemLink/copyItemLink/vyreLink kind in the sources must be one this table knows
test("no copy action writes a kind the table does not know", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|sample|fixture/.test(e.name)) files.push(p);
    }
  };
  walk(root);
  const known = new Set([
    ...OPENS.flatMap(([, l]) => [l.match(/^vyre:\/\/([a-z_]+)\//)?.[1] ?? ""]),
    ...UNOPENABLE.map(([, l]) => l.match(/^vyre:\/\/([a-z_]+)\//)?.[1] ?? ""),
    "open",
    "chats",
    "records",
    "files",
    "vault",
    "inbox",
    "automations",
    "home",
    "apps",
    "console",
    "settings",
  ]);
  const unknown: string[] = [];
  const typeKnown = new Set([
    "chat",
    "file",
    "folder",
    "note",
    "automation",
    "agent",
    "person",
    "record",
    "vault_item",
    "vault_folder",
    "site",
    "thread",
    "project",
    "goal",
    "machine",
    "run",
    "channel",
    "message",
  ]);
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/vyre:\/\/([a-z_]+)\//g))
      if (!known.has(m[1]!)) unknown.push(`${path.relative(root, f)}: vyre://${m[1]}/`);
    for (const m of src.matchAll(/(?:itemLink|copyItemLink|vyreLink)\("([a-z_]+)"/g))
      if (!typeKnown.has(m[1]!)) unknown.push(`${path.relative(root, f)}: ${m[0]}`);
  }
  assert.deepEqual(
    unknown,
    [],
    "put the new shape in OPENS (and make the resolver open it) or in UNOPENABLE with a reason",
  );
});
