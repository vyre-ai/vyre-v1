// How a model is sized up for a helper (owner, 4 Nov 2026): a cost tier by its name, and what it can do. Cheap models read, search and check; strong ones reason, write code and write. The names are the vendors'
// own words (flash, mini, haiku, pro, opus), so a model nobody has heard of is "standard" until its name says otherwise.

export type Tier = "cheap" | "standard" | "strong";
export type Job = "read" | "think";

const CHEAP = /(flash|mini|nano|haiku|lite|small|fast|luna|turbo|free|spark)/i;
const STRONG = /(opus|pro\b|-pro|max|ultra|large|k3\.1|k3$|gpt-6|gpt-5\.6$|argon|thinking|reason)/i;
const VISION = /(gpt|gemini|claude|kimi-k3|qwen3\.8-max|grok|muse|vl|vision)/i;

export function tierOf(model: string): Tier {
  if (CHEAP.test(model) && !/pro\b/i.test(model)) return "cheap";
  if (STRONG.test(model)) return "strong";
  return "standard";
}

export const modelCaps = (model: string): { tools: boolean; vision: boolean } => ({
  tools: !/(embed|whisper|tts|image-gen)/i.test(model),
  vision: VISION.test(model),
});

/** The tier a job wants: reading, searching and checking are cheap; reasoning, code and writing are strong. */
export const tierFor = (job: Job): Tier => (job === "read" ? "cheap" : "strong");

/** The model of a tier within one account's list: the first of that tier, else the nearest tier up, else down. */
export function pick(models: readonly string[], tier: Tier): string | undefined {
  const order: Tier[] =
    tier === "cheap"
      ? ["cheap", "standard", "strong"]
      : tier === "strong"
        ? ["strong", "standard", "cheap"]
        : ["standard", "cheap", "strong"];
  for (const t of order) {
    const m = models.find((x) => tierOf(x) === t);
    if (m) return m;
  }
  return models[0];
}

const READ_OPEN =
  /^\s*(?:please\s+)?(?:read|find|look\s*up|look\s+for|search|list|check|extract|pull|collect|gather|fetch|count|locate|open|scan|grep|summari[sz]e|report\s+(?:what|which|how\s+many))\b/i;
/** A verb that makes the work judgement, writing or a change: one of these anywhere and the brief is not a plain read. */
const NOT_READ =
  /\b(?:write|draft|rewrite|compose|edit|change|fix|implement|build|create|make|update|modify|delete|remove|send|publish|post|merge|push|commit|deploy|decide|recommend|propose|plan|design|review|evaluate|assess|analy[sz]e|compare|judge|argue|negotiate|reply|respond|answer\s+the|refactor|migrate|translate|investigate|debug|diagnose|why)\b/i;

/**
 * The job a helper's brief is, when it is plainly reading, searching or extracting and nothing else (r42-runtime-tokens, DIRECTION-agent-runtime C: a fast model for reads and extraction, a strong one for
 * judgement and writing). Conservative on purpose: a brief that opens with a read verb, is short, and holds no verb of writing, changing or judging is "read"; anything else is undefined, and the helper
 * keeps the model it would have had. Never "think": the strong model is the default already, and a wrong "read" costs quality while a missed one only costs money.
 */
export function briefJob(brief: string): "read" | undefined {
  const text = brief.trim();
  if (text.length === 0 || text.length > 1_500) return undefined;
  if (!READ_OPEN.test(text)) return undefined;
  return NOT_READ.test(text) ? undefined : "read";
}
