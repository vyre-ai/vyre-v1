// The rubric of the about-vyre skill evals. A scenario is a question about Vyre itself, the words the owner really used earlier in that chat, and the trace a model that follows the skill
// produces. No model runs here: the checker replays the trace against the frozen tool list and the skill's text, so an answer can only claim what the skill says, and the answers the owner
// actually got ("I searched memory and found nothing about Vyre", "Codex is not a supported backend") are caught by name.
import { ABOUT_VYRE_INTENT } from "../../../lib/about-vyre.ts";
import { finalSay, isCall, isSay, secretNever, toolsAvailable } from "./rules.ts";
import type { Check, Scenario, Step, Tools, Violation, World } from "./rules.ts";

/** What the owner said to his Assistant (2 Nov). Every scenario starts from one of these. */
export const OWNER_WORDS: readonly string[] = [
  "What do you think about Vyre?",
  "I am looking at it as a replacement for my Claude CLI and Codex CLI for long running development sessions and general project management",
];

/** What the Assistant answered him. Each is a known wrong answer: no answer may say it, or anything like it. */
export const ANSWERS_HE_GOT: readonly string[] = [
  "I searched memory and found nothing about Vyre.",
  "I don't see any sign that Codex is a supported backend.",
  "I can't tell how it handles context limits, crashes or resuming a very long session.",
  "I haven't seen how it handles branches, PRs or CI.",
];

const ENGINE = String.raw`(codex|claude code|grok|openrouter|opencode( go)?|ollama|anthropic|openai|xai)`;
/** The shapes of those answers: not knowing the product it runs in, or calling a supported engine unsupported. */
export const WRONG: readonly RegExp[] = [
  /\bsearched (my |the )?memor(y|ies)\b[^.]*\bnothing\b/i,
  /\b(found|know|have) nothing (about|on) vyre\b/i,
  /\b(don't|do not|can't|cannot) (see|find)\b[^.]{0,40}\b(sign|evidence|mention|trace)\b/i,
  new RegExp(String.raw`\b${ENGINE}\b[^.]{0,40}\b(is not|isn't|are not|aren't|not)\s+(a |an )?(supported|option)\b`, "i"),
  new RegExp(String.raw`\b(doesn't|does not|don't|do not|can't|cannot|won't|will not) (support|run on|work with)\b[^.]{0,20}\b${ENGINE}\b`, "i"),
  /\b(not|isn't|is not|aren't|are not) (a )?(supported|first-class)\b[^.]{0,20}\b(backend|engine|provider)\b/i,
  /\b(can't|cannot|can not) tell how (it|vyre) handles\b/i,
  /\b(haven't|have not|did not|didn't) see(n)? (how|whether|if) (it|vyre)\b/i,
  /\b(don't|do not) know (much )?(about|what) vyre\b/i,
];

const TOOL_WORD = /\b[a-z]+(?:_[a-z0-9]+)+\b/g;
/** Reads that check this Space before the answer says what is connected or set up here. */
export const SPACE_READS: ReadonlySet<string> = new Set(["engine_providers_list", "engine_accounts_list", "spaces_matrix", "projects_list", "engine_crew_repo_get", "github_repos_list"]);

/** An about-vyre scenario: the question, the owner's words before it, the facts its answer must give (each also in the skill), and the limit it must name. */
export interface AboutScenario extends Scenario {
  said: string;
  facts: string[];
  limits?: string[];
}

export interface AboutWorld extends World { skill: string }

const re = (s: string): RegExp => new RegExp(s, "i");

/** The question loads the skill by itself: the words match the intent the turn context tests. */
const aboutLoaded = (s: AboutScenario): Array<{ step: number; message: string }> => (ABOUT_VYRE_INTENT.test(s.prompt) ? [] : [{ step: 0, message: `"${s.prompt}" does not load about-vyre` }]);

/** No step says one of the answers the owner got, or one shaped like it. */
const noKnownWrong = (s: AboutScenario): Array<{ step: number; message: string }> => s.trace.flatMap((t, i) => {
  if (!isSay(t)) return [];
  const hit = WRONG.find((w) => w.test(t.say));
  return hit ? [{ step: i, message: `says what the owner was wrongly told: ${hit.exec(t.say)?.[0] ?? ""}` }] : [];
});

/** The answer gives each fact the question needs, and the skill backs every one: nothing is claimed that the skill does not say. */
const saysFacts = (s: AboutScenario, w: AboutWorld): Array<{ step: number; message: string }> => {
  const say = finalSay(s.trace);
  const out: Array<{ step: number; message: string }> = [];
  for (const f of s.facts) {
    if (!re(f).test(say)) out.push({ step: s.trace.length - 1, message: `the answer does not say ${f}` });
    if (!re(f).test(w.skill)) out.push({ step: -1, message: `${f} is not in the skill, so the answer cannot rest on it` });
  }
  return out;
};

/** The answer names a limit the skill lists under Limits today. */
const namesALimit = (s: AboutScenario, w: AboutWorld): Array<{ step: number; message: string }> => {
  const limits = w.skill.split(/^## /m).find((p) => p.startsWith("Limits today")) ?? "";
  const say = finalSay(s.trace);
  const named = (s.limits ?? []).filter((l) => re(l).test(say) && re(l).test(limits));
  return named.length > 0 ? [] : [{ step: s.trace.length - 1, message: "the answer names no limit from the skill's Limits today" }];
};

/** What depends on this Space is read before it is answered. */
const checksSpace = (s: AboutScenario): Array<{ step: number; message: string }> => {
  const at = s.trace.findIndex((t) => isCall(t) && SPACE_READS.has(t.call));
  const last = s.trace.length - 1 - [...s.trace].reverse().findIndex(isSay);
  return at >= 0 && at < last ? [] : [{ step: 0, message: "answers what is connected or set up here without reading this Space first" }];
};

/** An engine that is not connected here is offered, with how to connect it: never called unsupported. */
const connectNotUnsupported = (s: AboutScenario): Array<{ step: number; message: string }> => {
  const out: Array<{ step: number; message: string }> = [];
  const off = s.trace.flatMap((t) => (isCall(t) && t.call === "engine_providers_list" && t.result && "ok" in t.result && t.result.ok
    ? ((t.result.data as { providers?: Array<{ title: string; connected: boolean }> } | undefined)?.providers ?? []).filter((p) => !p.connected).map((p) => p.title) : []));
  const say = finalSay(s.trace);
  for (const title of off) {
    if (!new RegExp(String.raw`\b${title}\b`, "i").test(say)) continue;
    if (!/\b(connect|sign[- ]in|sign in|add)\b/i.test(say) || !/\bVault\b/.test(say)) out.push({ step: s.trace.length - 1, message: `${title} is not connected here and the answer does not say how to connect it in the Vault` });
    if (new RegExp(String.raw`\b${title}\b[^.]{0,30}\bnot (supported|available)\b`, "i").test(say)) out.push({ step: s.trace.length - 1, message: `${title} is called unsupported because it is not connected` });
  }
  if (off.length === 0) out.push({ step: 0, message: "no engine in the check is unconnected: this scenario cannot test the rule" });
  return out;
};

/** The person reads places and buttons, not tool names. */
const plainWords = (s: AboutScenario, _w: AboutWorld, tools: Tools): Array<{ step: number; message: string }> =>
  s.trace.flatMap((t, i) => (isSay(t) ? [...t.say.matchAll(TOOL_WORD)].map((m) => m[0]).filter((n) => tools.byName(n)).map((n) => ({ step: i, message: `names the tool ${n} to the person` })) : []));

type AboutCheck = (s: AboutScenario, w: AboutWorld, tools: Tools) => Array<{ step: number; message: string }>;

export const ABOUT_RULES: Readonly<Record<string, AboutCheck>> = {
  about_loaded: aboutLoaded,
  no_known_wrong: noKnownWrong,
  says_facts: saysFacts,
  names_a_limit: namesALimit,
  checks_space: checksSpace,
  connect_not_unsupported: connectNotUnsupported,
  plain_words: plainWords,
  tools_available: toolsAvailable as Check as AboutCheck,
};

/** Run every rule a scenario names, plus the secret rule and the known wrong answers, which always apply. */
export function evaluateAbout(scn: AboutScenario, world: AboutWorld, tools: Tools): Violation[] {
  const out: Violation[] = [];
  for (const name of new Set(["secret_never_printed", "no_known_wrong", ...scn.rules])) {
    const check: AboutCheck | undefined = name === "secret_never_printed" ? (secretNever as Check as AboutCheck) : ABOUT_RULES[name];
    if (!check) { out.push({ rule: name, scenario: scn.id, step: -1, message: `unknown rule ${name}` }); continue; }
    for (const v of check(scn, world, tools)) out.push({ rule: name, scenario: scn.id, step: v.step, message: v.message });
  }
  return out;
}

export type { Step };
