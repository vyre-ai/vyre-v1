// ui/ShareSheet: one sheet for every resource; every change is one access.share or access.unshare call (spec 2.4, 4.9; ARCH 4.12).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { menuEntries } from "../Menu/index.tsx";
import { isHead, isItem, isReportItem, isSeparator } from "../Menu/props.ts";
import {
  LINK_SUBJECT_ID,
  SHARE_CAPABILITY,
  SHARE_LEVELS,
  ShareSheet,
  UNSHARE_CAPABILITY,
  addMenu,
  effectiveLevel,
  frozenShareSheetProps,
  levelsFor,
  removable,
  rowSub,
  shareInput,
  sheetRows,
  sheetSubtitle,
  unshareInput,
} from "./index.tsx";
import type { ShareRow } from "./index.tsx";

const row = (over: Partial<ShareRow> & Pick<ShareRow, "name">): ShareRow => ({ subjectKind: "person", subjectId: `prs_${over.name.toLowerCase()}`, level: "view", via: "grant", fromFolderId: null, ...over });
const ALL = ["view", "use", "edit", "manage"] as const;

test("a person share maps to access.share with the resource, the subject and the level", () => {
  assert.equal(SHARE_CAPABILITY, "access.share");
  assert.deepEqual(shareInput(frozenShareSheetProps, { kind: "person", id: "prs_omar" }, "edit"), { resource: { type: "folder", id: "fld_clients" }, subject: { kind: "person", id: "prs_omar" }, level: "edit" });
  for (const kind of ["group", "role", "agent"] as const) {
    assert.deepEqual(shareInput(frozenShareSheetProps, { kind, id: "x" }, "use").subject, { kind, id: "x" });
  }
});

test("a link grant maps to access.share with subject kind link and is view only whatever was asked", () => {
  assert.equal(effectiveLevel("link", "manage"), "view");
  assert.equal(effectiveLevel("person", "manage"), "manage");
  assert.deepEqual(shareInput(frozenShareSheetProps, { kind: "link", id: LINK_SUBJECT_ID }, "edit"), { resource: { type: "folder", id: "fld_clients" }, subject: { kind: "link", id: "public" }, level: "view" });
});

test("removing maps to access.unshare by resource and subject", () => {
  assert.equal(UNSHARE_CAPABILITY, "access.unshare");
  assert.deepEqual(unshareInput(frozenShareSheetProps, { kind: "person", id: "prs_omar" }), { resource: { type: "folder", id: "fld_clients" }, subject: { kind: "person", id: "prs_omar" } });
});

test("the four levels, with the words the sheet and the contract share", () => {
  assert.deepEqual(SHARE_LEVELS.map((l) => l.label), ["View", "Use", "Edit", "Manage"]);
});

test("an inherited row can be raised, never lowered; a link is view only; a type may offer fewer levels", () => {
  assert.deepEqual(levelsFor(row({ name: "Maya", via: "folder", level: "edit" }), ALL), ["edit", "manage"]);
  assert.deepEqual(levelsFor(row({ name: "Maya", via: "grant", level: "edit" }), ALL), ["view", "use", "edit", "manage"]);
  assert.deepEqual(levelsFor(row({ name: "Public", subjectKind: "link" }), ALL), ["view"]);
  assert.deepEqual(levelsFor(row({ name: "Maya" }), ["view", "edit"]), ["view", "edit"]);
});

test("only a direct grant can be removed here", () => {
  assert.equal(removable({ via: "grant" }), true);
  assert.equal(removable({ via: "folder" }), false);
  assert.equal(removable({ via: "space" }), false);
  assert.equal(removable({ via: "owner" }), false);
});

test("rows: direct first by access, then the folder's, and the link apart", () => {
  const r = sheetRows([row({ name: "Zed", level: "view" }), row({ name: "Amy", level: "manage" }), row({ name: "Kai", via: "folder", level: "view", fromFolderId: "fld_a" }), row({ name: "Public", subjectKind: "link", subjectId: "public" })]);
  assert.deepEqual(r.direct.map((x) => x.name), ["Amy", "Zed"]);
  assert.deepEqual(r.inherited.map((x) => x.name), ["Kai"]);
  assert.equal(r.link?.name, "Public");
});

test("the Add menu lists People, Groups, Roles and Agents; anyone already added is checked and does nothing", () => {
  const added: string[] = [];
  const items = addMenu({ people: [{ id: "prs_omar", name: "Omar" }, { id: "prs_maya", name: "Maya" }], groups: [{ id: "grp_ops", name: "Operations" }], roles: [{ id: "rol_admin", name: "Admin" }], agents: [{ id: "agt_intake", name: "Intake" }] }, [row({ name: "Omar", subjectId: "prs_omar" })], (s) => added.push(`${s.kind}:${s.id}`));
  assert.deepEqual(items.filter(isHead).map((h) => h.head), ["People", "Groups", "Roles", "Agents"]);
  const omar = items.filter(isItem).find((i) => i.label === "Omar");
  assert.equal(omar?.checked, true);
  assert.equal(omar?.onSelect, undefined);
  for (const e of items) if (isItem(e)) e.onSelect?.();
  assert.deepEqual(added, ["person:prs_maya", "group:grp_ops", "role:rol_admin", "agent:agt_intake"]);
  const full = menuEntries({ items });
  const last = full[full.length - 1];
  assert.ok(last && isReportItem(last));
  assert.ok(isSeparator(full[full.length - 2] as never));
});

test("the rendered sheet: title, subtitle, owner, shares with their level, Done", () => {
  const html = renderToStaticMarkup(<ShareSheet {...frozenShareSheetProps} />);
  assert.match(html, /Share “Clients”/);
  assert.match(html, /Folder\. Sharing it covers everything inside\./);
  assert.match(html, /Irfad/);
  assert.match(html, /Owner/);
  assert.match(html, /Omar/);
  assert.match(html, /aria-label="Level for Omar: Edit"/);
  assert.match(html, /data-testid="share-remove-prs_omar"/);
  assert.match(html, /aria-label="Done"/);
  assert.match(html, /role="dialog"/);
  assert.doesNotMatch(html, /share-link-toggle/, "no link row unless the Console allows outside sharing");
});

test("a row is a ui/Row: the whole row is the hover and selection target", () => {
  const html = renderToStaticMarkup(<ShareSheet {...frozenShareSheetProps} />);
  assert.match(html, /data-testid="row-share-prs_omar"/);
  assert.match(html, /data-testid="row-share-owner"/);
});

test("with outside sharing allowed the link row offers Create link; with a link it offers Remove and Copy link", () => {
  const off = renderToStaticMarkup(<ShareSheet {...frozenShareSheetProps} allowExternal />);
  assert.match(off, /aria-label="Create link"/);
  assert.match(off, /No link/);
  const on = renderToStaticMarkup(<ShareSheet {...frozenShareSheetProps} allowExternal onCopyLink={() => undefined} shares={[row({ name: "Public", subjectKind: "link", subjectId: "public" })]} />);
  assert.match(on, /aria-label="Remove link"/);
  assert.match(on, /aria-label="Copy link"/);
  assert.match(on, /Anyone with the link/);
  assert.match(on, /Can view\. Outside the Space\./);
});

test("an item in a folder shows what comes from the folder and says it can be raised, never lowered", () => {
  const html = renderToStaticMarkup(<ShareSheet {...frozenShareSheetProps} resourceType="site" resourceId="site_1" resourceName="Landing" target="item" folderName="Clients" shares={[row({ name: "Kai", via: "folder", level: "view", fromFolderId: "fld_clients" })]} />);
  assert.match(html, /In the folder Clients\./);
  assert.match(html, /From the folder Clients/);
  assert.match(html, /never lowered/);
  assert.doesNotMatch(html, /share-remove-prs_kai/, "an inherited row has no remove button");
  assert.equal(sheetSubtitle({ target: "item" }), "Not in a folder.");
  assert.equal(rowSub(row({ name: "Kai", via: "folder" }), "Clients"), "From the folder Clients");
  assert.equal(rowSub(row({ name: "Ops", subjectKind: "group" })), "Group");
});

test("the level hints list only the levels the type offers", () => {
  const html = renderToStaticMarkup(<ShareSheet {...frozenShareSheetProps} levels={["view", "edit"]} />);
  assert.match(html, /View: see it and how it is doing/);
  assert.match(html, /Edit: change how it works/);
  assert.doesNotMatch(html, /Manage: share it/);
});

test("an empty sheet says so", () => {
  const html = renderToStaticMarkup(<ShareSheet {...frozenShareSheetProps} shares={[]} />);
  assert.match(html, /Nobody else yet\./);
});
