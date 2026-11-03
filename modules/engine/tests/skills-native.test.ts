// Skills on a Claude Code or Codex chat, natively (modules/engine/skills-native.ts): the skills the agent uses for the person are written where the CLI looks for its own in the work folder, with
// their files, only when the set changed, never over a folder Vyre did not write. The CLI is the golden-streams stand-in, a real process started with the argv the driver builds, that lists what
// it finds in its folder the way the CLI would.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLI_ADAPTERS, createCliDriver } from "../../../agent/src/drivers/cli/index.ts";
import { collect, driverDeps, newSpy, specOf, texts, turnOf } from "../../../agent/fixtures/golden-streams/rig.ts";
import { NATIVE_MANIFEST, skillDir, syncNativeSkills, withNativeSkills } from "../skills-native.ts";
import type { EngineEvent, EngineSession, OpenSession, SessionSpec, TurnInput } from "../../../agent/src/turn-engine/types.ts";

const SKILL = (name: string, desc: string, body = "Do the thing.") => `---\nname: ${name}\ndescription: ${desc}\nallowed-tools: Bash\n---\n\n${body}\n`;
interface Lib { name: string; tier: string; source: string; text: string; files: Record<string, string>; shadowedBy?: string; broken?: string; enabled?: boolean }

function world(lib: Lib[]) {
  const log: Array<{ cap: string; input: Record<string, unknown>; as?: string | undefined }> = [];
  const hash = (l: Lib) => `${l.text.length}:${Object.keys(l.files).length}:${l.text.slice(-12)}`;
  const call = async (cap: string, input: unknown, as?: string): Promise<unknown> => {
    log.push({ cap, input: input as Record<string, unknown>, as });
    if (cap === "skills.list") return { skills: lib.map((l) => ({ name: l.name, description: "", tier: l.tier, source: l.source, hash: hash(l), ...(l.shadowedBy ? { shadowedBy: l.shadowedBy } : {}), ...(l.broken ? { broken: l.broken } : {}), enabled: l.enabled ?? true })) };
    if (cap === "skills.load") {
      const l = lib.find((x) => x.name === (input as { name: string }).name && !x.shadowedBy)!;
      return { skill: { name: l.name, description: "", tier: l.tier, source: l.source, body: "", text: l.text, files: Object.entries(l.files).map(([p, t]) => ({ path: p, text: t })) } };
    }
    throw new Error(`unexpected ${cap}`);
  };
  return { call, log };
}
const work = (): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-skills-native-")));
const LIB = (): Lib[] => [
  { name: "triage", tier: "agent", source: "agent", text: SKILL("triage", "The intake agent's own triage steps."), files: { "notes.md": "extra notes" } },
  { name: "deploy-checks", tier: "space", source: "upload", text: SKILL("deploy-checks", "Run the checks before a deploy."), files: { "scripts/check.sh": "#!/bin/sh\necho ok\n", "references/list.md": "one two" } },
  { name: "triage", tier: "space", source: "upload", text: SKILL("triage", "Space triage."), files: {}, shadowedBy: "agent" },
  { name: "half-written", tier: "space", source: "upload", text: "x", files: {}, broken: "Its SKILL.md cannot be read" },
  { name: "switched-off", tier: "space", source: "upload", text: SKILL("switched-off", "Off."), files: {}, enabled: false },
  { name: "greeter:greeting", tier: "space", source: "plugin:greeter", text: SKILL("greeter:greeting", "From a plugin."), files: {} },
  { name: "working-in-vyre", tier: "builtin", source: "vyre", text: SKILL("working-in-vyre", "The manual."), files: {} },
];

test("Claude Code: the Space's and the agent's own skills are in .claude/skills of the work folder with their files, read as the asker; built-in, plugin, beaten, broken and off ones are not", async () => {
  const w = work();
  const wd = world(LIB());
  const r = await syncNativeSkills(wd, "claude_code", "agt_intake", "per_dana", w);
  assert.deepEqual(r, { written: ["triage", "deploy-checks"] });
  const base = path.join(w, ".claude", "skills");
  assert.equal(fs.readFileSync(path.join(base, "triage", "SKILL.md"), "utf8"), SKILL("triage", "The intake agent's own triage steps."), "the agent's own copy, front matter and all");
  assert.equal(fs.readFileSync(path.join(base, "triage", "notes.md"), "utf8"), "extra notes");
  assert.equal(fs.readFileSync(path.join(base, "deploy-checks", "references", "list.md"), "utf8"), "one two");
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(base, "deploy-checks", "scripts", "check.sh")).mode & 0o111, 0o111, "a script can be run from beside its skill");
  assert.deepEqual(fs.readdirSync(base).sort(), [NATIVE_MANIFEST, "deploy-checks", "triage"]);
  assert.ok(wd.log.every((l) => l.as === "per_dana" && l.input["agentId"] === "agt_intake"));

  // the CLI finds them where it looks for its own
  const spy = newSpy();
  const session = await createCliDriver(CLI_ADAPTERS.claude_code, driverDeps(spy, { workFolder: () => w })).open(specOf());
  const said = texts(await collect(session.send(turnOf("skills")))).join("");
  await session.close();
  assert.equal(said, "deploy-checks:description: Run the checks before a deploy.:references/list.md,scripts/check.sh|triage:description: The intake agent's own triage steps.:notes.md");
  assert.ok(spy.launches[0]!.includes("Skill"), "Claude Code may open them");
});

test("Codex: the same skills go in .agents/skills, where Codex looks", async () => {
  const w = work();
  await syncNativeSkills(world(LIB()), "codex", "agt_intake", "per_dana", w);
  const spy = newSpy();
  const session = await createCliDriver(CLI_ADAPTERS.codex, driverDeps(spy, { workFolder: () => w })).open(specOf());
  const said = texts(await collect(session.send(turnOf("skills")))).join("");
  await session.close();
  assert.match(said, /^deploy-checks:description: Run the checks before a deploy\.:references\/list\.md,scripts\/check\.sh\|triage:/);
  assert.equal(fs.existsSync(path.join(w, ".claude")), false);
});

test("written only when the set changed: an unchanged turn reads one list and writes nothing; a changed or removed skill is rewritten; a folder Vyre did not write is never touched", async () => {
  const w = work();
  const lib = LIB();
  const wd = world(lib);
  const base = path.join(w, ".claude", "skills");
  // the repository's own skill of the same name as one of Vyre's: it stays, and Vyre's is left out
  fs.mkdirSync(path.join(base, "deploy-checks"), { recursive: true });
  fs.writeFileSync(path.join(base, "deploy-checks", "SKILL.md"), "the repository's own");
  assert.deepEqual(await syncNativeSkills(wd, "claude_code", "agt_intake", "per_dana", w), { written: ["triage"] });
  assert.equal(fs.readFileSync(path.join(base, "deploy-checks", "SKILL.md"), "utf8"), "the repository's own");
  const loads = () => wd.log.filter((l) => l.cap === "skills.load").length;
  const before = loads();
  assert.equal(await syncNativeSkills(wd, "claude_code", "agt_intake", "per_dana", w), "same");
  assert.equal(loads(), before, "nothing was loaded again");
  // the agent's own triage changes, and a new one arrives
  lib[0]!.text = SKILL("triage", "Triage, rewritten.");
  lib.push({ name: "new-one", tier: "space", source: "upload", text: SKILL("new-one", "Just added."), files: {} });
  assert.deepEqual(await syncNativeSkills(wd, "claude_code", "agt_intake", "per_dana", w), { written: ["triage", "new-one"] });
  assert.match(fs.readFileSync(path.join(base, "triage", "SKILL.md"), "utf8"), /Triage, rewritten\./);
  // a skill removed from the library leaves the folder; the repository's stays
  lib.splice(lib.findIndex((l) => l.name === "new-one"), 1);
  await syncNativeSkills(wd, "claude_code", "agt_intake", "per_dana", w);
  assert.deepEqual(fs.readdirSync(base).sort(), [NATIVE_MANIFEST, "deploy-checks", "triage"]);
  assert.equal(fs.readFileSync(path.join(base, "deploy-checks", "SKILL.md"), "utf8"), "the repository's own");
});

test("in a git work folder (a teammate's copy of a repository) the written skills stay out of what it commits", async () => {
  const w = work();
  fs.mkdirSync(path.join(w, ".git", "info"), { recursive: true });
  fs.writeFileSync(path.join(w, ".git", "info", "exclude"), "/CLAUDE.md\n/AGENTS.md\n");
  await syncNativeSkills(world(LIB()), "claude_code", "agt_intake", "per_dana", w);
  await syncNativeSkills(world([...LIB(), { name: "more", tier: "space", source: "upload", text: SKILL("more", "More."), files: {} }]), "claude_code", "agt_intake", "per_dana", w);
  const lines = fs.readFileSync(path.join(w, ".git", "info", "exclude"), "utf8").split("\n").filter(Boolean);
  assert.deepEqual(lines, ["/CLAUDE.md", "/AGENTS.md", "/.claude/skills/triage/", "/.claude/skills/deploy-checks/", `/.claude/skills/${NATIVE_MANIFEST}`, "/.claude/skills/more/"]);
});

test("a skill name becomes a folder name a CLI accepts", () => {
  assert.equal(skillDir("deploy-checks"), "deploy-checks");
  assert.equal(skillDir("Greeter:Greeting Now"), "greeter-greeting-now");
  assert.equal(skillDir("../../etc"), "etc");
  assert.equal(skillDir("!!!"), "skill");
});

test("before every turn of a Claude Code or Codex chat the skills are refreshed, so one added mid-chat reaches a running engine; an API chat and a step get nothing written", async () => {
  const w = work();
  const lib = LIB();
  const wd = world(lib);
  const turns: string[] = [];
  const inner: OpenSession = async () => ({
    warm: true,
    async *send(i: TurnInput): AsyncIterable<EngineEvent> { turns.push(fs.readdirSync(path.join(w, ".claude", "skills")).sort().join(",")); void i; yield { type: "done" } as EngineEvent; },
    sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
  }) as unknown as EngineSession;
  const open = withNativeSkills(inner, { call: wd.call, workOf: () => w });
  const spec = (driver: string, tools?: "none"): SessionSpec => ({ threadId: "thr_1", agent: { id: "agt_intake", mode: "lead" }, asker: "per_dana", turnId: "t", traceId: "0", account: { driver } as never, ...(tools ? { tools } : {}) });
  const turn = (): TurnInput => ({ threadId: "thr_1", turnId: "t1", agent: { id: "agt_intake", mode: "lead" }, history: [], listeners: [], asker: "per_dana" } as unknown as TurnInput);
  const s = await open(spec("claude_code"));
  for await (const _ of s.send(turn())) void _;
  lib.push({ name: "mid-chat", tier: "space", source: "upload", text: SKILL("mid-chat", "Added mid-chat."), files: {} });
  for await (const _ of s.send(turn())) void _;
  assert.deepEqual(turns, [`${NATIVE_MANIFEST},deploy-checks,triage`, `${NATIVE_MANIFEST},deploy-checks,mid-chat,triage`]);
  const lists = wd.log.filter((l) => l.cap === "skills.list").length;
  for (const sp of [spec("anthropic"), spec("claude_code", "none")]) { const x = await open(sp); for await (const _ of x.send(turn())) void _; }
  assert.equal(wd.log.filter((l) => l.cap === "skills.list").length, lists, "nothing is read or written for them");
});
