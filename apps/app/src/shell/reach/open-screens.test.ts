// Every screen the app opens by name goes somewhere (f-wire, 12 Nov). The one door (session.ts open) finds the place of a screen in the generated registry, or, for a screen a place draws
// from its own hash, the place its id starts with. A screen id that is neither reached no place: the click did nothing. A place-local id must also be one its place reads, or the place opens
// on its landing instead of the page asked for ("settings.mail" opened Settings on Profile; Settings reads "settings.page" with a page, or "mail.connections").
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { screensById } from "../../../../../generated/screens.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const RAIL = new Set(["home", "chats", "inbox", "records", "files", "apps", "automations", "vault", "settings", "console"]);

/** The files where each place reads a screen id from its hash. A place-local id must be named in one of them. */
const READERS: Readonly<Record<string, readonly string[]>> = {
  chats: ["apps/app/src/places/chats/mounts/route.ts"],
  files: ["apps/app/src/places/files/memory/know.ts", "apps/app/src/shell/providers/files.tsx"],
  settings: ["apps/app/src/shell/providers/settings.tsx"],
  automations: ["apps/app/src/shell/providers/automations.tsx"],
};

/** Every `open({ screen: "..." })` (a ternary's branches too) in the app's own code. */
function opened(): Array<{ at: string; id: string }> {
  const files = ["apps/app/src", "ui/src"].flatMap((d) => (fs.readdirSync(path.join(root, d), { recursive: true }) as string[]).map((f) => `${d}/${f}`))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/(\.test\.|\/tests?\/|\/fixtures?\/|sample|\.support\.)/.test(f));
  const out: Array<{ at: string; id: string }> = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    for (const m of src.matchAll(/\bopen\(([^;\n]{0,400})/g)) {
      const call = m[1]!;
      for (const s of call.matchAll(/\{\s*screen:\s*["']([a-z][a-z0-9_.-]+)["']/g)) out.push({ at: `${f}:${src.slice(0, m.index).split("\n").length}`, id: s[1]! });
    }
  }
  return out;
}

test("every screen the app opens by name is a registry screen, or one its place reads from the hash", () => {
  const all = opened();
  assert.ok(all.length > 40, `found the opens (${all.length})`);
  const bad: string[] = [];
  for (const { at, id } of all) {
    if (screensById.has(id)) continue;
    const place = id.split(".")[0]!;
    if (!RAIL.has(place)) { bad.push(`${at} opens ${id}: no registry screen and no place`); continue; }
    const readers = READERS[place] ?? [];
    if (!readers.some((r) => fs.readFileSync(path.join(root, r), "utf8").includes(`"${id}"`))) bad.push(`${at} opens ${id}: the ${place} place never reads that screen`);
  }
  assert.deepEqual(bad, []);
});
