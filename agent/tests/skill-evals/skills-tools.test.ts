// The built-in skills (agent/skills/*/SKILL.md) can only teach what the tools can do: every tool a skill names in backticks exists in the generated tool list, every skill has the open
// SKILL.md front matter, and the focus skill of each place is there. A renamed tool or a skill that names one that never existed fails here.
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { loadGenerated } from "../../src/tools/harness.ts";

const root = new URL("../../skills/", import.meta.url);
const dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const gen = loadGenerated();
const text = (dir: string): string => readFileSync(new URL(`${dir}/SKILL.md`, root), "utf8");
/** Words in backticks that look like a tool name (snake_case with an underscore) but are block types or fields. */
const NOT_TOOLS = new Set(["secret_input", "sources_kind", "diff_card"]);

test("the places each have a focus skill, and the manual, loops and computer skills are there", () => {
  for (const n of ["working-in-vyre", "focus-records", "focus-files", "focus-automations", "focus-vault", "focus-inbox", "focus-apps", "focus-console", "agent-loops", "agent-computer", "working-on-tasks"]) assert.ok(dirs.includes(n), n);
});

test("every skill has the front matter of an open SKILL.md: name equal to its folder, a description, system true", () => {
  for (const d of dirs) {
    const s = text(d);
    assert.match(s, /^---\n/, d);
    assert.match(s, new RegExp(`^name: ${d}$`, "m"), `${d}: name is the folder`);
    assert.match(s, /^description: .{30,300}$/m, `${d}: description`);
    assert.match(s, /^system: true$/m, `${d}: system`);
  }
});

test("every tool a skill names in backticks is a real tool", () => {
  for (const d of dirs) {
    const words = new Set([...text(d).matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map((m) => m[1]!));
    for (const w of words) if (!NOT_TOOLS.has(w)) assert.ok(gen.catalog.byName(w), `${d}: \`${w}\` is not a tool`);
  }
});

test("every tool named with a handle or call shape in a skill, such as foo(...) , is also real", () => {
  for (const d of dirs) {
    for (const m of text(d).matchAll(/\b([a-z]+(?:_[a-z0-9]+)+)\(/g)) assert.ok(gen.catalog.byName(m[1]!), `${d}: ${m[1]}( is not a tool`);
  }
});

test("a focus skill stays short enough to load into a turn", () => {
  for (const d of dirs) assert.ok(text(d).length < 12_000, `${d}: ${text(d).length} characters`);
});
