// How big a model's context window is.
//
// Order of truth (windowInfo):
//   1. reported   what the provider or engine said about this model: an API model list row (OpenRouter context_length, Anthropic max_input_tokens, Gemini inputTokenLimit, ...)
//                 or the engine's own turn metadata (Claude Code modelUsage.contextWindow, Codex model_context_window). Kept per provider+model by reportWindow.
//   2. the table  FALLBACK_WINDOWS below, only when nothing was reported. Checked against the providers' own docs on 6 Nov 2026:
//                   Anthropic  platform.claude.com/docs/en/build-with-claude/context-windows: 1M is the default (no beta header) for Fable/Mythos 5 and 5.1, Opus 5, 5.5, 4.6, 4.7, 4.8,
//                              Sonnet 5, 5.5, 4.6, Haiku 5.5. Every other Claude (Sonnet 4.5, Opus 4.5, Haiku 4.5 and older) is 200k.
//                   OpenAI     developers.openai.com/api/docs/models: GPT-6 family 1.05M. GPT-5 and Codex models keep 258.4k (what Codex CLI uses of the model's 400k); Codex reports its own.
//                   xAI        docs.x.ai/docs/models: grok-4.3 and grok-4.20 1M, grok-4.5/4.6/4.7 500k, grok-build 256k.
//                   Google     aistudio.google.com/docs/models: Gemini 4 Argon 1M; Gemini 3 and 2.5 families 1M.
//                   DeepSeek   api-docs.deepseek.com/quick_start/pricing: V4 Flash and V4 Pro 1M.
//                   Z.ai GLM   docs.z.ai: GLM-5.2 and 5.3 families 1M; GLM-5.1, 5, 4.7, 4.6 200k.
//   3. DEFAULT_WINDOW for a model nothing names.
// An unnamed model (the pick is Auto) is sized by what the provider last reported for the model it ran, never by a flat number.

/** First match wins. Most specific rows first. */
export const FALLBACK_WINDOWS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\[1m\]|[-_]1m\b|\b1m\b/i, 1_000_000],
  // Claude: the 4.5 generation and older are 200k, whatever the family word
  [/(opus|sonnet|haiku)[-_ ]?4[-_.]?5\b|claude-3|claude-(opus|sonnet|haiku)-4(-\d{8}|\s|$)|claude-2|claude-instant/i, 200_000],
  [/claude|fable|mythos|opus|sonnet|haiku/i, 1_000_000],
  [/gpt-?6/i, 1_050_000],
  [/gemini/i, 1_000_000],
  [/grok[-_]?4[-_.]?(3|20)\b/i, 1_000_000],
  [/grok[-_]?4[-_.]?[5-9]\b/i, 500_000],
  [/grok/i, 256_000],
  [/deepseek/i, 1_000_000],
  [/glm[-_ ]?(5[-_.]?[2-9]|[6-9])/i, 1_000_000],
  [/glm/i, 200_000],
  [/gpt-?5|codex|\bo[134]\b/i, 258_400],
];
/** Kept for callers that read the old name. */
export const WINDOWS = FALLBACK_WINDOWS;
export const DEFAULT_WINDOW = 128_000;

export type WindowSource = "reported" | "table" | "default";
export interface WindowInfo { tokens: number; source: WindowSource }

const reported = new Map<string, number>();       // `${provider}/${model}` and `/${model}`
const lastByProvider = new Map<string, number>();  // the window of the model a provider last said it ran

const norm = (m: string): string => m.trim().toLowerCase().replace(/^models\//, "");
const sane = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 4_000 && n <= 100_000_000;

/** A provider or engine said this model's window. Later reports replace earlier ones. */
export function reportWindow(model: string | null | undefined, tokens: unknown, provider?: string | null): void {
  if (!sane(tokens)) return;
  const t = Math.trunc(tokens);
  const m = model ? norm(model) : "";
  if (m !== "") {
    reported.set(`/${m}`, t);
    if (provider) reported.set(`${provider}/${m}`, t);
  }
  if (provider) lastByProvider.set(provider, t);
}

/** Forget every reported window (tests). */
export function clearWindows(): void { reported.clear(); lastByProvider.clear(); }

export function windowInfo(model: string | null | undefined, provider?: string | null): WindowInfo {
  const m = model ? norm(model) : "";
  if (m !== "") {
    const hit = (provider ? reported.get(`${provider}/${m}`) : undefined) ?? reported.get(`/${m}`);
    if (hit !== undefined) return { tokens: hit, source: "reported" };
  } else if (provider) {
    // Auto: the model the engine really ran on sizes the window
    const last = lastByProvider.get(provider);
    if (last !== undefined) return { tokens: last, source: "reported" };
  }
  const hay = `${m} ${provider && provider !== "claude" ? provider : ""}`;
  for (const [re, n] of FALLBACK_WINDOWS) if (re.test(hay)) return { tokens: n, source: "table" };
  // no model named: the newest family of the engine's own vendor
  if (m === "" && (provider === "claude" || provider === "claude-code" || provider === "anthropic")) return { tokens: 1_000_000, source: "table" };
  return { tokens: DEFAULT_WINDOW, source: "default" };
}

export function windowFor(model: string | null | undefined, provider?: string | null): number {
  return windowInfo(model, provider).tokens;
}

/** "1M context", "258k context": how a window reads in a picker. */
export function windowLabel(tokens: number): string {
  return tokens >= 1_000_000 ? `${Math.round((tokens / 1_000_000) * 100) / 100}M context` : `${Math.round(tokens / 1000)}k context`;
}
