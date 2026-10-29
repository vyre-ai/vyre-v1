// The memory interview: three short answers become facts in the person's own memory layer (source: manual, ref: onboarding). The person wrote them, so a fact that comes back
// "proposed" is accepted at once. Nothing is sent to a model; it works with or without an AI account.
import type { CapCall } from "../shell/session/caps.ts";

export interface Question { key: "work" | "tools" | "style"; ask: string; hint: string; fact(answer: string): string }
export const QUESTIONS: readonly Question[] = [
  { key: "work", ask: "What do you do?", hint: "Your role, in a few words", fact: (a) => `Works as: ${a}` },
  { key: "tools", ask: "Which tools do you use every day?", hint: "Apps, services, the places your work lives", fact: (a) => `Uses every day: ${a}` },
  { key: "style", ask: "How should I talk to you?", hint: "Short or detailed, formal or relaxed", fact: (a) => `Prefers answers that are: ${a}` },
];

export const cleanAnswer = (raw: string): string => raw.replace(/\s+/g, " ").trim().slice(0, 400);

type Fact = { factId: string; status: "proposed" | "current" | "closed" | "removed" };

/** Saves every non-empty answer; answers left blank are skipped. Resolves with how many facts were saved. */
export async function saveInterview(call: CapCall, answers: Partial<Record<Question["key"], string>>, runId: string): Promise<number> {
  let saved = 0;
  for (const q of QUESTIONS) {
    const text = cleanAnswer(answers[q.key] ?? "");
    if (text === "") continue;
    const out = await call("memory.propose_fact", { layer: "person", text: q.fact(text), sourceKind: "manual", sourceRef: "onboarding", kind: "preference", idempotencyKey: `${runId}:${q.key}` }) as { fact: Fact };
    if (out.fact.status === "proposed") await call("memory.fact.accept", { factId: out.fact.factId });
    saved++;
  }
  return saved;
}
