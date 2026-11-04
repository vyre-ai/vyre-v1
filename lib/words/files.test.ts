// Every file event reads as who did what to which file; none leaks an id, an event name or a module word.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileEventWords } from "./files.ts";
import { leaksCode } from "./audit.ts";

const registry = JSON.parse(readFileSync(new URL("../../generated/registry.json", import.meta.url), "utf8")) as { events: { name?: string; key?: string }[] };
const folder = (id: string): string | undefined => ({ fld_1: "Clients / Rivera", fld_2: "Marketing" })[id];
const o = { fileName: "Fee agreement.pdf", folder };

test("each file event is a plain sentence", () => {
  assert.equal(fileEventWords("file.moved", { toFolderId: "fld_1" }, o), "moved Fee agreement.pdf to Clients/Rivera");
  assert.equal(fileEventWords("file.renamed", { from: "Draft.pdf", to: "Fee agreement.pdf" }, o), "renamed Draft.pdf to Fee agreement.pdf");
  assert.equal(fileEventWords("file.created", { name: "Fee agreement.pdf", folderId: "fld_2" }, o), "added Fee agreement.pdf to Marketing");
  assert.equal(fileEventWords("file.deleted", {}, o), "deleted Fee agreement.pdf");
  assert.equal(fileEventWords("file.restored", { folderId: "fld_2" }, o), "restored Fee agreement.pdf to Marketing");
  assert.equal(fileEventWords("file.shared_external", { linkId: "lnk_9" }, o), "shared Fee agreement.pdf with a link");
  assert.equal(fileEventWords("file.markup_saved", {}, o), "edited Fee agreement.pdf");
  assert.equal(fileEventWords("file.version_added", { n: 3 }, o), "saved a new version of Fee agreement.pdf");
  assert.equal(fileEventWords("file.version_added", { n: 1 }, o), null);
  assert.equal(fileEventWords("file.redacted", { shape: "span", label: "Phone" }, o), "redacted a phone");
  assert.equal(fileEventWords("file.moved", { toFolderId: "fld_unknown" }, o), "moved Fee agreement.pdf");
});

test("every file.* event in the registry reads without a code word, or is left out on purpose", () => {
  const silent = new Set(["file.starred", "file.redact_ready"]);
  const bad: string[] = [];
  for (const e of registry.events) {
    const n = e.name ?? e.key ?? "";
    if (!n.startsWith("file.")) continue;
    const t = fileEventWords(n, { fileId: "fil_01abc", folderId: "fld_x", toFolderId: "fld_x", linkId: "lnk_x", versionId: "ver_x", n: 2, markId: "mrk_x" }, o);
    if (t === null) { if (!silent.has(n) && n !== "file.version_added") bad.push(`${n}: no line`); continue; }
    const why = leaksCode(t);
    if (why || /\b(fil|fld|lnk|ver|mrk)_/.test(t)) bad.push(`${n}: ${t} (${why ?? "id"})`);
  }
  assert.deepEqual(bad, []);
});
