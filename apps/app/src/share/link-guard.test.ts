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

/** Lines that read as a link made from an origin, reviewed and allowed one by one (never a whole file). Each is the exact text of one line and the reason it is safe. */
const REVIEWED_LINES: { file: string; line: string; why: string }[] = [
  {
    file: "apps/app/src/shell/session/entry.ts",
    line: 'new URL("/chat", target.address).href',
    why: "19 Nov 2026 (Getting in): browserLink hands the desktop app's own browser the Space's address as the person typed or saved it (target.address, never the page's origin), so it is not dead in the desktop app. It is not the address of a thing a person copies; it opens the Space itself. The line sits beside the invite form it replaces, which is why the tripwire matched.",
  },
];

/** The tripwire over one file's lines: the lines that take an origin or href and have link-shaped text beside them, minus the reviewed lines of that file. */
export function badLines(file: string, lines: string[]): string[] {
  const bad: string[] = [];
  lines.forEach((l, i) => {
    // a line that takes the page's origin, or the session's base address, to make the address of a thing
    const takesOrigin =
      /\.(?:origin|href)\b/.test(l) ||
      /plainLink\(/.test(l) ||
      /\b(?:rt|runtime)\.baseUrl\b[^;\n]*\/(?:a|open)\//.test(l);
    if (!takesOrigin) return;
    const near = lines.slice(Math.max(0, i - 3), i + 4).join("\n");
    if (!/\/a\/\$\{|\/open\/|#subject=|#screen=|\/join\/|\/callback|plainLink\(/.test(near)) return;
    if (REVIEWED_LINES.some((r) => file.endsWith(r.file) && l.includes(r.line) && !/location\.|window\./.test(l)))
      return;
    bad.push(`${file}:${i + 1}`);
  });
  return bad;
}

test("no file but the link maker builds the address of a thing from location.origin or rt.baseUrl", () => {
  const bad: string[] = [];
  for (const dir of ["apps/app/src", "ui/src"])
    for (const f of walk(path.join(root, dir))) {
      if (f.endsWith("apps/app/src/share/rows.ts")) continue;
      // reviewed, 14 Nov 2026: the resolver of a pasted link. It reads the pasted address's origin to compare it with this Space's own; it builds no address
      if (f.endsWith("apps/app/src/shell/reach/space-link.ts")) continue;
      bad.push(...badLines(path.relative(root, f), fs.readFileSync(f, "utf8").split("\n")));
    }
  assert.deepEqual(
    bad,
    [],
    "build links with itemLink / messageLink (apps/app/src/share/rows.ts), which use the Space's own address",
  );
});

test("the reviewed line is allowed only as written: the same shape from the page's origin, or in another file, is still caught", () => {
  const file = "apps/app/src/shell/session/entry.ts";
  const ok = [
    '  return target.kind === "join"',
    "    ? `${target.address}/join/${target.code}#fp=${target.fingerprint}`",
    '    : new URL("/chat", target.address).href;',
  ];
  assert.deepEqual(badLines(file, ok), [], "the reviewed line passes");
  const fromPage = [ok[0]!, ok[1]!, '    : new URL("/chat", location.origin).href;'];
  assert.equal(badLines(file, fromPage).length, 1, "a page origin on that line is caught");
  const otherForm = [ok[0]!, ok[1]!, '    : new URL("/chat", target.address).origin + "/x";'];
  assert.equal(badLines(file, otherForm).length, 1, "another shape of line is caught");
  assert.equal(badLines("apps/app/src/shell/other.ts", ok).length, 1, "the same line in another file is caught");
  const rtBuilt = ["const u = `${rt.baseUrl}/a/${id}`;", "const href = u;"];
  assert.equal(
    badLines("apps/app/src/x.ts", rtBuilt).length,
    1,
    "a link built from the session's base address is caught",
  );
});
