// The skills that steer agents name real tools. Every backticked tool in the Sites, Forms and Artifacts skills is a capability an agent can call, under that name.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { registry } from "../../generated/registry.ts";

const toolName = (c: { name: string; surfaces?: { mcp?: { name?: string } } }): string => c.surfaces?.mcp?.name ?? c.name.replaceAll(".", "_");
const tools = new Set((registry.capabilities as unknown as { name: string; surfaces?: { mcp?: { name?: string } } }[]).filter((c) => c.surfaces?.mcp).map(toolName));

for (const skill of ["sites", "forms", "artifacts", "focus-apps"]) {
  test(`${skill}: every tool it names exists`, () => {
    const text = fs.readFileSync(new URL(`./${skill}/SKILL.md`, import.meta.url), "utf8");
    const named = [...text.matchAll(/`([a-z]+_[a-z_]+)`/g)].map((m) => m[1] as string).filter((n) => !["form_submitted"].includes(n) && !["waiting_dns"].includes(n));
    assert.ok(named.length > 0, "it names tools");
    const missing = named.filter((n) => !tools.has(n));
    assert.deepEqual([...new Set(missing)], []);
  });
}

test("Forms can be run from tools alone: create, fields, publish, read answers", () => {
  for (const n of ["forms_create", "forms_fields_set", "forms_design_set", "forms_update", "forms_publish", "forms_unpublish", "forms_submissions", "forms_link_create"]) assert.ok(tools.has(n), n);
});
