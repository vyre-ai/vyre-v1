// Every kind a screen looks up by name has an entry in the screen's table: a kind that is missing shows a blank label or icon, or throws on `.map` of undefined. The kinds are read from the
// generated contract types (and the sheet's own item types), so a new kind in the contract fails here until its entry is written.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DIGEST_KIND_LABEL } from "./home/sections-a/model.ts";
import { ICON as DIGEST_ICON } from "./home/sections-a/AwayDigest.tsx";
import { STAR_LABEL } from "./home/sections-b/model.ts";
import { DOES } from "./settings/Approvals.tsx";
import { SECTIONS } from "./settings/model.ts";
import { levelHint } from "../../../../ui/src/AccessSheet/model.ts";

const types = fs.readFileSync(new URL("../../../../generated/types.ts", import.meta.url), "utf8");
/** The members of the longest string-literal union that holds `anchor`. */
function union(src: string, anchor: string): string[] {
  const found = [...src.matchAll(/"[a-z_0-9]+"(?: \| "[a-z_0-9]+")+/g)].map((m) => m[0]).filter((u) => u.includes(`"${anchor}"`));
  assert.ok(found.length > 0, `a union holding ${anchor}`);
  return found.sort((a, b) => b.length - a.length)[0]!.split(" | ").map((x) => x.slice(1, -1));
}

test("every digest kind, hold act and starred type has its words", () => {
  for (const k of union(types, "record_change")) {
    assert.ok(DIGEST_KIND_LABEL[k as keyof typeof DIGEST_KIND_LABEL], `digest label for ${k}`);
    assert.ok(DIGEST_ICON[k as keyof typeof DIGEST_ICON], `digest icon for ${k}`);
  }
  for (const a of union(types, "enroll_node")) assert.ok(DOES[a as keyof typeof DOES], `approval words for ${a}`);
  for (const t of union(types, "automation_group")) assert.ok(STAR_LABEL[t as keyof typeof STAR_LABEL], `star label for ${t}`);
});

test("every settings page has its sections, and every shareable item type has level hints", () => {
  const model = fs.readFileSync(new URL("./settings/model.ts", import.meta.url), "utf8");
  for (const p of union(model, "notifications")) assert.ok(Array.isArray(SECTIONS[p as keyof typeof SECTIONS]), `sections for ${p}`);
  const props = fs.readFileSync(new URL("../../../../ui/src/AccessSheet/props.ts", import.meta.url), "utf8");
  for (const t of union(props, "rtype")) assert.notEqual(levelHint(t as never, "view") + levelHint(t as never, "use"), "", `level hints for ${t}`);
});
