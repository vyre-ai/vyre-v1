// An audit row or an event in a person's words: who did what to which thing, no dotted names, ids or module words. Every act the registry has is run through the guard.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actParts, auditPhrase, auditSentence, leaksCode, sayWords } from "./audit.ts";

const registry = JSON.parse(readFileSync(new URL("../../generated/registry.json", import.meta.url), "utf8")) as { capabilities: { name: string; audit?: string }[]; events: { name: string }[] };

test("known acts read as sentences", () => {
  assert.equal(auditSentence({ actor: "Priya Raman", action: "files.save", resource: "Fee agreement.pdf" }), "Priya Raman saved Fee agreement.pdf");
  assert.equal(auditSentence({ actor: "Priya Raman", action: "files.save" }), "Priya Raman saved a file");
  assert.equal(auditSentence({ actor: "Dex", action: "tasks.working_notes.set", onBehalfOf: "Andrey" }), "Dex changed the working notes of a task, for Andrey");
  assert.equal(auditSentence({ actor: "Omar", action: "tasks.working_notes.set", resource: "Send Josh the link" }), "Omar changed the working notes of Send Josh the link");
  assert.equal(auditSentence({ actor: "Sara", action: "records.create" }), "Sara created a record");
  assert.equal(auditSentence({ actor: "Sara", action: "files.delete" }), "Sara deleted a file");
  assert.equal(auditSentence({ actor: "Mira", action: "vault.share" }), "Mira shared the Vault");
  assert.equal(auditSentence({ actor: "", action: "access.actors.create" }), "Someone created an outside tool in access settings");
});

test("events read the same way, and a state needs no actor", () => {
  assert.equal(auditPhrase("file.comment_resolved"), "resolved the comment of a file");
  assert.equal(auditPhrase("file.renamed", "plan.md"), "renamed plan.md");
  assert.match(auditSentence({ actor: "x", action: "call.recording_ready" }), /^Call recording is ready$|^Recording of a call is ready$/i);
});

test("code words are said plainly", () => {
  assert.equal(sayWords("working_notes"), "working notes");
  assert.equal(sayWords("mcp"), "connected tool");
  assert.equal(sayWords("pull_request"), "pull request");
  assert.deepEqual(actParts("access.actors.create").verb, "created");
});

test("every act the registry has reads without a dotted name, an id, an underscore word or a module word", () => {
  const acts = [...new Set([...registry.capabilities.map((c) => c.name), ...registry.events.map((e) => e.name)])];
  assert.ok(acts.length > 1500, `${acts.length} acts`);
  const bad: string[] = [];
  for (const a of acts) {
    for (const line of [auditSentence({ actor: "Priya Raman", action: a }), auditSentence({ actor: "Priya Raman", action: a, resource: "Fee agreement.pdf", onBehalfOf: "Andrey" })]) {
      const why = leaksCode(line);
      if (why) bad.push(`${a}: ${line} (${why})`);
      if (!/^[A-Z]/.test(line) || line.length < 8) bad.push(`${a}: "${line}" is not a sentence`);
    }
  }
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} acts leak code`);
});

test("the guard catches what it is for", () => {
  assert.equal(leaksCode("Priya files save the item"), null);
  assert.ok(leaksCode("Priya ran tasks.update"));
  assert.ok(leaksCode("Opened rec_01a1b2c3d4e5f6"));
  assert.ok(leaksCode("Priya did working_notes"));
  assert.ok(leaksCode("The epoch bumped"));
  assert.equal(leaksCode("Priya saved Fee agreement.pdf"), null, "a file name is not a dotted name");
});
