// Native skills on a Windows computer (lane l-winfix): Windows-shaped names and paths, checked with path.win32 on any machine. One file the disk refuses never drops the other skills; a name Windows
// cannot hold is made one it can; a "skill.md" beside SKILL.md never replaces it; a path past MAX_PATH is written in the long form.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { longPath, skillDir, skillFile, syncNativeSkills } from "../skills-native.ts";

const SKILL = (name: string) => `---\nname: ${name}\ndescription: ${name} steps\n---\n\nDo it.\n`;
const work = (): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-skills-win-")));

function world(lib: Array<{ name: string; text: string; files: Record<string, string> }>) {
  const logs: string[] = [];
  return {
    logs,
    log: (m: string, a?: Record<string, unknown>) => { logs.push(`${m} ${JSON.stringify(a)}`); },
    call: async (cap: string, input: unknown): Promise<unknown> => {
      if (cap === "skills.list") return { skills: lib.map((l) => ({ name: l.name, tier: "space", source: "upload", hash: String(l.text.length) })) };
      const l = lib.find((x) => x.name === (input as { name: string }).name)!;
      return { skill: { name: l.name, text: l.text, files: Object.entries(l.files).map(([p, t]) => ({ path: p, text: t })) } };
    },
  };
}

test("a skill's folder is never a Windows device name", () => {
  for (const [name, dir] of [["CON", "con-skill"], ["nul", "nul-skill"], ["Com1", "com1-skill"], ["lpt9", "lpt9-skill"], ["aux", "aux-skill"], ["prn", "prn-skill"], ["con-tracts", "con-tracts"], ["console", "console"]] as const) {
    assert.equal(skillDir(name), dir, name);
  }
});

test("a skill's file names, as Windows can hold them: refused characters, trailing dots and spaces, device names; never outside the folder, never SKILL.md in any case", () => {
  const w = (p: string) => skillFile(p, "win32");
  assert.equal(w("scripts/check.sh"), "scripts\\check.sh");
  assert.equal(w("notes: draft?.md"), "notes_ draft_.md");
  assert.equal(w("a<b>|c*\"d\".txt"), "a_b__c__d_.txt");
  assert.equal(w("trailing. . "), "trailing");
  assert.equal(w("refs/con.txt"), "refs\\_con.txt");
  assert.equal(w("NUL"), "_NUL");
  assert.equal(w("dir./file "), "dir\\file");
  assert.equal(w("..\\..\\Windows\\win.ini"), null);
  assert.equal(w("a\\..\\..\\x"), null);
  assert.equal(w("skill.md"), null);
  assert.equal(w("./Skill.MD"), null);
  assert.equal(skillFile("skill.md", "darwin"), null, "a Mac's disk does not count case either");
  assert.equal(skillFile("notes: draft?.md", "linux"), "notes: draft?.md", "on a Mac or Linux the name is kept as it is");
});

test("a path past MAX_PATH is written in the long form on Windows; a short one and every POSIX path as they are", () => {
  const deep = `C:\\Users\\Dana Reyes\\AppData\\Roaming\\ai.vyre.desktop\\personal\\work\\usr_${"a".repeat(26)}\\thr_${"b".repeat(26)}\\.claude\\skills\\${"c".repeat(64)}\\references\\${"d".repeat(60)}.md`;
  assert.ok(deep.length > 260);
  assert.equal(longPath(deep, "win32"), `\\\\?\\${deep}`);
  assert.equal(longPath("\\\\fileserver\\share\\" + "x".repeat(250), "win32"), `\\\\?\\UNC\\fileserver\\share\\${"x".repeat(250)}`);
  assert.equal(longPath("C:\\short\\SKILL.md", "win32"), "C:\\short\\SKILL.md");
  assert.equal(longPath(`/${"x".repeat(300)}`, "linux"), `/${"x".repeat(300)}`);
  // the worst case Vyre makes itself, before a skill's own file path: profile folder (a local account name is at most 20), the data folder, the work folder's ids, the CLI's skills folder and a
  // 64-character skill name. SKILL.md fits under MAX_PATH; a supporting file deeper than about 30 characters does not, which is why the writes take the long form.
  const worst = `C:\\Users\\${"u".repeat(20)}\\AppData\\Roaming\\ai.vyre.desktop\\personal\\work\\usr_${"a".repeat(26)}\\thr_${"b".repeat(26)}\\.agents\\skills\\${"c".repeat(64)}\\SKILL.md`;
  assert.ok(worst.length < 260, String(worst.length));
});

test("one file the disk refuses loses that file only; the other files and the other skills are written", async () => {
  const w = work();
  const lib = [
    { name: "alpha", text: SKILL("alpha"), files: { "notes.md": "alpha notes", "skill.md": "would replace SKILL.md on a case-blind disk", "blocked/inner.md": "x", "zz.md": "after" } },
    { name: "beta", text: SKILL("beta"), files: { "ref.md": "beta ref" } },
    { name: "CON", text: SKILL("con"), files: {} },
  ];
  const wd = world(lib);
  const orig = fs.mkdirSync;
  // the disk refuses one folder (as Windows refuses "aux" or a path it cannot hold)
  (fs as { mkdirSync: typeof fs.mkdirSync }).mkdirSync = ((p: fs.PathLike, o?: fs.MakeDirectoryOptions) => {
    if (String(p).endsWith(`${path.sep}blocked`)) throw Object.assign(new Error("EINVAL: invalid argument, mkdir"), { code: "EINVAL" });
    return orig(p, o);
  }) as typeof fs.mkdirSync;
  let r: Awaited<ReturnType<typeof syncNativeSkills>>;
  try { r = await syncNativeSkills(wd, "claude_code", "agt_1", "per_dana", w); } finally { (fs as { mkdirSync: typeof fs.mkdirSync }).mkdirSync = orig; }
  assert.deepEqual(r, { written: ["alpha", "beta", "con-skill"] });
  const base = path.join(w, ".claude", "skills");
  assert.equal(fs.readFileSync(path.join(base, "alpha", "SKILL.md"), "utf8"), SKILL("alpha"), "a skill.md never replaces the skill's own text");
  assert.equal(fs.readFileSync(path.join(base, "alpha", "notes.md"), "utf8"), "alpha notes");
  assert.equal(fs.readFileSync(path.join(base, "alpha", "zz.md"), "utf8"), "after", "the file after the refused one is written");
  assert.equal(fs.existsSync(path.join(base, "alpha", "blocked")), false);
  assert.equal(fs.readFileSync(path.join(base, "beta", "ref.md"), "utf8"), "beta ref");
  assert.ok(fs.existsSync(path.join(base, "con-skill", "SKILL.md")));
  assert.ok(wd.logs.some((l) => l.includes("could not be written") && l.includes("blocked")), wd.logs.join("\n"));
});
