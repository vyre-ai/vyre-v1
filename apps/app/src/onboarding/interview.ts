// The memory interview: three short answers become facts in the person's own memory layer (source: manual, ref: onboarding). The person wrote them, so a fact that comes back
// "proposed" is accepted at once. Nothing is sent to a model; it works with or without an AI account.
import type { CapCall } from "../shell/session/caps.ts";
import type { StepAsk } from "./said.ts";
import { POPULAR_ROLES, POPULAR_TOOLS } from "./work-kinds.ts";

export interface Question {
  key: "work" | "tools" | "style";
  ask: string;
  hint: string;
  fact(answer: string): string;
}
export const QUESTIONS: readonly Question[] = [
  { key: "work", ask: "What do you do?", hint: "Your role, in a few words", fact: (a) => `Works as: ${a}` },
  {
    key: "tools",
    ask: "Which tools do you use every day?",
    hint: "Apps, services, the places your work lives",
    fact: (a) => `Uses every day: ${a}`,
  },
  {
    key: "style",
    ask: "How should I talk to you?",
    hint: "Short or detailed, formal or relaxed",
    fact: (a) => `Prefers answers that are: ${a}`,
  },
];

export const cleanAnswer = (raw: string): string => raw.replace(/\s+/g, " ").trim().slice(0, 400);

type Fact = { factId: string; status: "proposed" | "current" | "closed" | "removed" };

/** Saves every non-empty answer; answers left blank are skipped. Resolves with how many facts were saved. */
export async function saveInterview(
  call: CapCall,
  answers: Partial<Record<Question["key"], string>>,
  runId: string,
): Promise<number> {
  let saved = 0;
  for (const q of QUESTIONS) {
    const text = cleanAnswer(answers[q.key] ?? "");
    if (text === "") continue;
    const out = (await call("memory.propose_fact", {
      layer: "person",
      text: q.fact(text),
      sourceKind: "manual",
      sourceRef: "onboarding",
      kind: "preference",
      idempotencyKey: `${runId}:${q.key}`,
    })) as { fact: Fact };
    if (out.fact.status === "proposed") await call("memory.fact.accept", { factId: out.fact.factId });
    saved++;
  }
  return saved;
}

export interface SavedAnswer {
  factId: string;
  text: string;
}
export type SavedAnswers = Partial<Record<Question["key"], SavedAnswer>>;

/** Saves answers the first time and, when the step is reopened, corrects only what changed (memory.fact.correct on the fact already made), so editing never leaves the old words beside the new. */
export async function saveInterviewEdit(
  call: CapCall,
  answers: Partial<Record<Question["key"], string>>,
  runId: string,
  saved: SavedAnswers = {},
): Promise<{ count: number; saved: SavedAnswers }> {
  const next: SavedAnswers = { ...saved };
  let count = 0;
  for (const q of QUESTIONS) {
    const text = cleanAnswer(answers[q.key] ?? "");
    if (text === "") continue;
    const before = saved[q.key];
    if (before && before.text === text) {
      count++;
      continue;
    }
    if (before) {
      await call("memory.fact.correct", { factId: before.factId, text: q.fact(text) });
      next[q.key] = { factId: before.factId, text };
    } else {
      const out = (await call("memory.propose_fact", {
        layer: "person",
        text: q.fact(text),
        sourceKind: "manual",
        sourceRef: "onboarding",
        kind: "preference",
        idempotencyKey: `${runId}:${q.key}`,
      })) as { fact: { factId: string; status: string } };
      if (out.fact.status === "proposed") await call("memory.fact.accept", { factId: out.fact.factId });
      next[q.key] = { factId: out.fact.factId, text };
    }
    count++;
  }
  return { count, saved: next };
}

/** The three lines of "Vyre knows", in the words a person reads. */
export const LABELS: Record<Question["key"], string> = {
  work: "What you do",
  tools: "Tools you use",
  style: "How you like updates",
};
export const STYLE_PICKS: readonly string[] = ["Short and to the point", "Full detail"];

/** The answer inside a saved fact ("Works as: designer" is "designer"); null when the text is not one of the three shapes. */
export function answerOf(key: Question["key"], text: string): string | null {
  const q = QUESTIONS.find((x) => x.key === key);
  const prefix = q ? q.fact("") : "";
  return prefix !== "" && text.startsWith(prefix) && text.length > prefix.length ? text.slice(prefix.length) : null;
}

export interface KnownFact {
  factId: string;
  text: string;
  status: string;
  learnedAt?: number;
}
/** What the person's memory holds of the three answers, however they were saved (this screen, the card, or the Assistant): the newest current fact of each shape. */
export function savedFromFacts(facts: readonly KnownFact[]): SavedAnswers {
  const out: SavedAnswers = {};
  const at: Partial<Record<Question["key"], number>> = {};
  for (const f of facts) {
    if (f.status !== "current") continue;
    for (const q of QUESTIONS) {
      const a = answerOf(q.key, f.text);
      if (a === null) continue;
      const t = f.learnedAt ?? 0;
      if (out[q.key] === undefined || t >= (at[q.key] ?? 0)) {
        out[q.key] = { factId: f.factId, text: a };
        at[q.key] = t;
      }
    }
  }
  return out;
}
/** The step is done when all three answers exist. */
export const interviewDone = (saved: SavedAnswers): boolean => QUESTIONS.every((q) => saved[q.key] !== undefined);

/** The question the Assistant asks next and the picks the card offers for it; once all three are saved there is nothing more to ask. */
export function interviewAsk(saved: SavedAnswers): StepAsk {
  const next = QUESTIONS.find((q) => saved[q.key] === undefined);
  if (!next) return { prompt: "That is all I need. Change any line, then Continue.", suggestions: [] };
  const picks =
    next.key === "work"
      ? POPULAR_ROLES.filter((r) => r !== "Attorney")
      : next.key === "tools"
        ? POPULAR_TOOLS
        : STYLE_PICKS;
  return { prompt: next.ask, suggestions: picks.slice(0, 4) };
}

export async function loadKnown(call: CapCall): Promise<SavedAnswers> {
  const out = (await call("memory.facts.list", { layer: "person", status: ["current"], limit: 200 })) as {
    facts: KnownFact[];
  };
  return savedFromFacts(out.facts);
}
/** Takes one line off the list: the fact is removed from the person's memory. */
export async function removeKnown(call: CapCall, factId: string): Promise<void> {
  await call("memory.facts.remove", { factIds: [factId] });
}
