// What one turn on an API model is sent, section by section, for a long chat in a team Space: the table the owner asked for after a 1.0M-input turn (about twenty calls re-sending it). The numbers are
// printed (about four characters to a token) and the caps that keep a section from growing without end are asserted.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROFILE_LINES_MAX, SKILL_INDEX_MAX, createContextBuilder } from "../context.ts";
import type { SkillsPort } from "../context.ts";
import type { StoredMessage, TurnInput } from "../../../agent/src/turn-engine/types.ts";

const read = (rel: string): string => readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");
const tok = (s: string): number => Math.round(s.length / 4);
const msg = (n: number, who: string, kind: "person" | "agent", body: string): StoredMessage => ({ id: `m${n}`, threadId: "thr_1", threadSeq: n, author: { kind, id: who }, mentions: [], depth: 0, body, at: 1 } as StoredMessage);

test("per-section size of a long chat's turn context, and what bounds each section (before the caps: skills 4216, person 1428, total 13308; the index showed 60 skills at 130 characters and a profile had no cap)", async () => {
  const manual = read("agent/skills/working-in-vyre/SKILL.md");
  const index = Array.from({ length: 90 }, (_, i) => ({ name: `skill-${i}`, description: "Use when the person wants this kind of thing done: a one-line description a skill index carries for each skill.", tier: "space" }));
  const skills: SkillsPort = { async index() { return [{ name: "working-in-vyre", description: "manual", tier: "builtin" }, ...index]; }, async load(name) { return name === "working-in-vyre" ? { name, body: manual } : null; } };
  const answers: Record<string, unknown> = {
    "agents.get": { agent: { agentId: "agt_intake", name: "Intake", role: "You answer intake questions for the firm. ".repeat(20), folderId: "fld_1", toolsAllowed: [], toolsDenied: [], vaultKeys: [], hasComputer: false } },
    "files.list": { files: [{ fileId: "fil_md", name: "AGENT.md" }] }, "files.read": { text: "# Intake\n" + "Be brief and kind. ".repeat(200) },
    "threads.get": { thread: { kind: "chat", title: "Intake desk", members: [{ kind: "person", id: "usr_maya" }, { kind: "person", id: "usr_omar" }], agents: [{ agentId: "agt_intake", mode: "lead" }, { agentId: "agt_docs", mode: "listen" }] } },
    "access.principals.list": { principals: [{ id: "usr_maya", kind: "person", name: "Maya Chen" }, { id: "usr_omar", kind: "person", name: "Omar Haddad" }] },
    "spaces.get": { space: { name: "Northwind", kind: "team" } }, "agents.routines.list": { routines: [] }, "settings.get": { row: { value: "UTC" } }, "computers.list": { computers: [] },
    "chat.transcript.summary": { summary: "Asked (turn 1): review the lease.\n".repeat(400) },
    "memory.profile.context": { audience: "private", people: [{ personId: "usr_maya", self: true, basics: ["Partner"], public: Array.from({ length: 30 }, (_, i) => `Prefers the short version of thing ${i}.`), private: Array.from({ length: 60 }, (_, i) => `A private fact number ${i} that was learned in an earlier chat.`) }] },
  };
  const call = async (cap: string): Promise<unknown> => { if (!(cap in answers)) throw new Error(cap); return answers[cap]; };
  const history = Array.from({ length: 50 }, (_, i) => msg(i + 1, i % 2 ? "agt_intake" : "usr_maya", i % 2 ? "agent" : "person", "A reply of the usual length. ".repeat(25)));
  const ctx = await createContextBuilder({ call, skills, now: () => 1_760_000_000_000 }).build({ threadId: "thr_1", turnId: "trn_1", agent: { id: "agt_intake", mode: "lead" }, trigger: history[48]!, history, listeners: [], asker: "usr_maya" } as TurnInput);
  const rows = ctx.sections.map((s) => [s.id, tok(s.text)] as const);
  const histTokens = tok(history.slice(ctx.keepHistory !== undefined ? -ctx.keepHistory : -50).map((m) => m.body).join("\n"));
  console.log("context per call (tokens): " + [...rows, ["history", histTokens] as const].map(([k, n]) => `${k} ${n}`).join(", ") + `; total ${rows.reduce((a, [, n]) => a + n, 0) + histTokens}`);
  const text = (id: string): string => ctx.sections.find((s) => s.id === id)?.text ?? "";
  assert.ok(index.length > SKILL_INDEX_MAX, "more skills than the index shows");
  assert.ok(text("skills").split("\n").filter((l) => l.startsWith("- skill-")).length <= SKILL_INDEX_MAX, "the skill index is capped");
  assert.ok(text("person").split("\n").filter((l) => l.startsWith("- ")).length <= 3 * PROFILE_LINES_MAX, "a profile is capped");
  assert.ok(tok(text("earlier")) <= 2_600, "the rolling summary is capped");
  assert.ok((ctx.keepHistory ?? 50) <= 20, "with a summary the history is the last twenty messages, not the fifty");
});

test("every turn carries one line about itself: the model and effort, who pays, where it runs, and where the rest is", async () => {
  const { runningLine } = await import("../context.ts");
  const spec = { agent: { id: "agt_1", mode: "lead" as const, model: "claude-sonnet-5-5", effort: "high" as const }, account: { ref: "#Claude_Code", name: "Claude Code (Max)", driver: "claude_code", provider: "anthropic", kind: "subscription" as const, payer: "usr_irfad", reason: "starter" as const } };
  assert.equal(runningLine(spec, "on the asker's own computer"), "This turn runs on Claude Sonnet 5.5 (high effort), paid by Claude Code (Max) · your sign-in, on the asker's own computer. What else the person may use and what is left on each is my_ai (never answer it from memory).");
  const swapped = runningLine({ ...spec, account: { ...spec.account, name: "OpenCode Go", driver: "opencode_go", kind: "api_key", shared: true, modelFallback: { from: "claude-sonnet-5-5", to: "glm-5.3" } } }, "on the Space's server");
  assert.match(swapped!, /^This turn runs on GLM 5\.3 \(high effort\), paid by OpenCode Go · Space account, on the Space's server\./, "the model that runs, not the one asked for");
  assert.equal(runningLine({ agent: { id: "a", mode: "lead" } }), undefined);
});
