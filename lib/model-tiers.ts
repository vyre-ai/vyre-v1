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

/** Mechanical verbs only: the work is picking out, copying, counting or formatting what is there, never reading it for meaning. */
const MECHANICAL_OPEN =
  /^\s*(?:please\s+)?(?:list|find|look\s*up|locate|extract|pull|collect|gather|fetch|copy|count|format|sort|tabulate)\b/i;
/** One of these anywhere and the brief is judgement, advice, legal substance or a file the fast model may not read: the strong model keeps it. */
const NOT_MECHANICAL = new RegExp(
  "\\b(?:" +
    [
      "summari[sz]\\w*|summary|digest|recap|gist|overview",
      "identify|determine|verify|validate|audit|flag|spot|detect|decide|assess|evaluate|review|analy[sz]\\w*|compare|judge|rank|prioriti[sz]e|recommend|advis\\w*|suggest|propose|plan|design|explain|interpret|infer|conclude|check|confirm|ensure|investigate|diagnose|debug",
      "cause|reason|key\\s+points?|polish\\w*|tone|clients?|e-?mails?|letters?|messages?|failing|out\\s+how|how\\s+(?!many\\b|much\\b)\\w+|works?|handled|whether|should|would|could|likely|probably|risk\\w*|best|better|worst|issues?|problems?|concerns?|why|how\\s+(?:come|do|does|did|should)|tell\\s+me|is\\s+it|are\\s+they|which\\s+(?:is|are|one)",
      "evidence|testimon\\w*|deposition|affidavit|discovery|privilege\\w*|liab\\w*|damages|negligen\\w*|breach\\w*|clause|compl(?:y|ies|iance)|contracts?|agreements?|leases?|terms|obligations?|rights?|legal|law|statute|regulation|court|case\\s+law|settlement|claims?|medical|diagnos\\w*",
      "write|draft|rewrite|compose|edit|change|fix|implement|build|create|make|update|modify|delete|remove|send|publish|post|merge|push|commit|deploy|reply|respond|refactor|migrate|translate|negotiate",
      "image|images|screenshot|photo|picture|scan(?:ned)?|pdf|attached|attachment|diagram|chart|handwrit\\w*|video|audio|recording",
    ].join("|") +
    ")\\b",
  "i",
);
/** A brief longer than this carries more than a plain lookup, and its inputs may not fit a small model's window. */
const MECHANICAL_MAX = 600;

/**
 * The job a helper's brief is, when it is plainly mechanical (r42-runtime-tokens, DIRECTION-agent-runtime C; strict after r-review and the lead, 19 Nov): it opens with list, find, extract, copy, count, format and the
 * like, is short, and holds no word of judgement, advice, legal substance, writing or changing, and names no image or document that needs eyes. Anything else is undefined and the helper keeps the model it would
 * have had: a wrong cheap pick on a judgement brief costs more than the tokens it saves. Never "think".
 */
export function briefJob(brief: string): "read" | undefined {
  const text = brief.trim();
  if (text.length === 0 || text.length > MECHANICAL_MAX) return undefined;
  if (!MECHANICAL_OPEN.test(text)) return undefined;
  return NOT_MECHANICAL.test(text) ? undefined : "read";
}
