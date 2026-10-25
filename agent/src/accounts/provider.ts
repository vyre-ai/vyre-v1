// Which provider an agent's model belongs to, so a person's own account is only matched when it can serve the model.
const PREFIXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^claude/i, "anthropic"],
  [/^(gpt|o[0-9]|chatgpt|codex)/i, "openai"],
  [/^gemini/i, "google"],
  [/^grok/i, "xai"],
];

/** 'anthropic/claude-sonnet-5-5' (router style) names its provider; bare model names are matched by family. Unknown models return undefined: any account may be tried. */
export function providerOfModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const slash = model.indexOf("/");
  if (slash > 0) return model.slice(0, slash).toLowerCase();
  for (const [re, provider] of PREFIXES) if (re.test(model)) return provider;
  return undefined;
}
