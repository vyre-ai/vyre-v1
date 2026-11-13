// react-native-web drops a `title` prop on Pressable, View and Text, so `{...webProps({ title: ... })}` never reached the page: the hover tip and the name it was meant to give were missing (13 Nov 2026,
// found when a disabled menu item's reason did not show). The one tooltip reads `data-tt`, which `dataSet: { tt }` does render. This test holds the count of the dropped form at zero.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DROPPED = /webProps\(\{\s*title\b/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "node_modules" && name !== "dist") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

export function droppedTitles(source: string): number {
  return (source.match(DROPPED) ?? []).length;
}

test("no title prop is spread onto a react-native-web component: use dataSet { tt } for the one tooltip", () => {
  const bad: string[] = [];
  for (const dir of ["apps/app/src", "ui/src"])
    for (const f of walk(join(ROOT, dir))) {
      const n = droppedTitles(readFileSync(f, "utf8"));
      if (n > 0) bad.push(`${relative(ROOT, f)}: ${n}`);
    }
  assert.deepEqual(
    bad,
    [],
    "a `title` on Pressable, View or Text is dropped by react-native-web; write dataSet: { tt: text } instead",
  );
});

test("the check sees the dropped form and not the cure", () => {
  assert.equal(droppedTitles('<View {...webProps({ title: "Stop" })} />'), 1);
  assert.equal(droppedTitles('<View {...webProps({ dataSet: { tt: "Stop" } })} />'), 0);
});
