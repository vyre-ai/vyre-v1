// from vyre 0.6.9 lib/windows.js@dbd2dfbab
// How big a model's context window is, by its name, for a session that has not reported its own.

/** First match wins. Agents report their own window when they can; this is the floor under a count made from characters. */
export const WINDOWS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\[1m\]|[-_]1m\b|\b1m\b/i, 1_000_000],
  [/gemini/i, 1_000_000],
  [/grok/i, 256_000],
  [/gpt-?5|codex|\bo[134]\b/i, 258_400],
  [/claude|opus|sonnet|haiku/i, 200_000],
];
export const DEFAULT_WINDOW = 128_000;

export function windowFor(model: string | null | undefined, provider?: string | null): number {
  const hay = `${model ?? ""} ${provider && provider !== "claude" ? provider : ""}`;
  for (const [re, n] of WINDOWS) if (re.test(hay)) return n;
  return provider === "claude" || (!model && !provider) ? 200_000 : DEFAULT_WINDOW;
}
