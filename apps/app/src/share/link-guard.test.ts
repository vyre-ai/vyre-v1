// TRIPWIRE, not a guarantee: it matches shapes of lines near a page origin. It misses a split `const o = location.origin` and `location.host`. The stronger form (no file under apps/app/src or ui/src reads `location` at all
// except a short reviewed list) is OWED.
// Every link a person can copy is made from the Space's own address by the one maker (rows.ts itemLink / messageLink). A link built from the page's origin is dead in the desktop app, where the page is
// tauri://localhost (13 Nov 2026: Share, Copy link). This fails on any other file that builds an address of a thing from `location.origin`.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "fixtures" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/sample|fixture/.test(e.name) ? [p] : [];
  });

test("no file but the link maker builds the address of a thing from location.origin or rt.baseUrl", () => {
  const bad: string[] = [];
  for (const dir of ["apps/app/src", "ui/src"])
    for (const f of walk(path.join(root, dir))) {
      if (f.endsWith("apps/app/src/share/rows.ts")) continue;
      // reviewed, 14 Nov 2026: the resolver of a pasted link. It reads the pasted address's origin to compare it with this Space's own; it builds no address
      if (f.endsWith("apps/app/src/shell/reach/space-link.ts")) continue;
      const lines = fs.readFileSync(f, "utf8").split("\n");
      lines.forEach((l, i) => {
        // a line that takes the page's origin, or the session's base address, to make the address of a thing
        const takesOrigin =
          /\.(?:origin|href)\b/.test(l) ||
          /plainLink\(/.test(l) ||
          /\b(?:rt|runtime)\.baseUrl\b[^;\n]*\/(?:a|open)\//.test(l);
        if (!takesOrigin) return;
        const near = lines.slice(Math.max(0, i - 3), i + 4).join("\n");
        if (/\/a\/\$\{|\/open\/|#subject=|#screen=|\/join\/|\/callback|plainLink\(/.test(near))
          bad.push(`${path.relative(root, f)}:${i + 1}`);
      });
    }
  assert.deepEqual(
    bad,
    [],
    "build links with itemLink / messageLink (apps/app/src/share/rows.ts), which use the Space's own address",
  );
});
