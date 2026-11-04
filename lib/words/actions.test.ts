// An act as a person says it: who did what to which thing, in the past tense, with no dots, underscores or ids; and a guard over every capability the audit log can name.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actionSentence, actionWords } from "./actions.ts";

test("acts read as sentences", () => {
  assert.equal(actionSentence({ who: "Priya Raman", action: "access.roles.assign", thing: "Omar Haddad" }), "Priya Raman assigned a role to Omar Haddad");
  assert.equal(actionSentence({ who: "Priya Raman", action: "access.groups.remove_member", thing: "Sales" }), "Priya Raman removed a member from Sales");
  assert.equal(actionSentence({ who: "Tom Reyes", action: "records.update", thing: "Acme Legal" }), "Tom Reyes changed the record Acme Legal");
  assert.equal(actionSentence({ who: "Irfad", action: "agents.delete", thing: "Dex", forWho: "Andrey" }), "Irfad deleted the agent Dex, for Andrey");
  assert.equal(actionSentence({ who: "Someone", action: "audit.viewed" }), "Someone opened the audit log");
  assert.equal(actionSentence({ who: "Aliza", action: "agents.create" }), "Aliza created an agent");
  assert.equal(actionWords("access.audience_set"), "changed the audience");
  assert.equal(actionWords("agents.routine.save"), "saved a routine");
  assert.equal(actionWords("vault.items.create"), "created an item");
  // an event name already in the past
  assert.equal(actionSentence({ who: "Priya Raman", action: "role.changed", thing: "Omar Haddad" }), "Priya Raman changed the role of Omar Haddad");
  assert.equal(actionSentence({ who: "Intake", action: "record.revealed", thing: "Rivera engagement", forWho: "Priya Raman" }), "Intake revealed the record Rivera engagement, for Priya Raman");
  assert.equal(actionSentence({ who: "Olivia Owner", action: "audit.viewed", thing: "space/spc_fresh" }), "Olivia Owner opened the audit log");
});

test("guard: no act the audit log can name reads with a dot, an underscore, an id or a bare code", () => {
  const caps = (JSON.parse(readFileSync(new URL("../../generated/registry.json", import.meta.url), "utf8")) as { capabilities: Array<{ name: string; audit?: string | null }> }).capabilities;
  assert.ok(caps.filter((x) => x.audit === "always" || x.audit === "sensitive").length > 400);
  for (const c of caps.filter((x) => x.audit === "always" || x.audit === "sensitive")) {
    const s = actionSentence({ who: "Priya Raman", action: c.name, thing: "Omar Haddad" });
    assert.ok(!/[._]/.test(s.replace("Omar Haddad", "").replace("Priya Raman", "")), `${c.name} reads "${s}"`);
    assert.ok(!/\b[a-z]{2,6}_[a-z0-9]{6,}\b/.test(s), `${c.name}: an id in "${s}"`);
    assert.ok(/^Priya Raman [a-z]/.test(s), `${c.name}: "${s}"`);
    assert.ok(s.length < 90, `${c.name}: "${s}" is long`);
  }
});
