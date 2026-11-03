// Native skills on a Windows computer (lane l-winfix): Windows-shaped names and paths, checked with path.win32 on any machine. One file the disk refuses never drops the other skills; a name Windows
// cannot hold is made one it can; a "skill.md" beside SKILL.md never replaces it; a path past MAX_PATH is left out.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WIN_MAX_FILE, fitsPath, skillDir, skillFile, syncNativeSkills } from "../skills-native.ts";

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
  assert.equal(skillDir("a".repeat(70), "win32"), "a".repeat(40));
  assert.equal(skillDir("a".repeat(70), "linux"), "a".repeat(64));
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

test("Windows: a file at MAX_PATH or past it is left out, since the engines do not read it; the worst case of Vyre's own part of the path leaves a skill room", () => {
  // the worst case Vyre makes itself: a profile folder of 36 characters (a domain profile "name.DOMAIN": a 20-character account name, a dot and a 15-character domain; a local account holds 20,
  // a Microsoft account 5), the app's data folder, the short work layout, the CLI's skills folder and a skill folder of 40 (Windows' cap)
  const data = `C:\\Users\\${"u".repeat(36)}\\AppData\\Roaming\\ai.vyre.desktop\\personal`;
  const work = `${data}\\w\\${"a".repeat(10)}\\${"b".repeat(10)}`;
  const skillMd = `${work}\\.agents\\skills\\${skillDir("c".repeat(64), "win32")}\\SKILL.md`;
  console.log(`worst case: work folder ${work.length}, SKILL.md ${skillMd.length}, room left for a skill's own file path ${WIN_MAX_FILE - skillMd.length + "SKILL.md".length}`);
  assert.ok(skillMd.length <= 180, `SKILL.md at most 180 characters in the worst case (${skillMd.length})`);
  assert.ok(WIN_MAX_FILE - (skillMd.length - "SKILL.md".length) >= 85, "a skill's own file path has at least 85 characters");
  assert.equal(fitsPath(skillMd, "win32"), true);
  assert.equal(fitsPath(`C:\\${"x".repeat(256)}`, "win32"), true, "259 characters fit");
  assert.equal(fitsPath(`C:\\${"x".repeat(257)}`, "win32"), false, "260 do not");
  assert.equal(fitsPath(`C:\\${"d".repeat(246)}\\f`, "win32"), false, "nor a file in a folder of 248");
  assert.equal(fitsPath(`/${"x".repeat(400)}`, "linux"), true);
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
