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

// A subscription sign-in is kept under the tool's own key (claude-code, codex, grok), a model names its maker (anthropic, openai, xai): the two spell one family.
const FAMILY: Readonly<Record<string, string>> = { "claude-code": "anthropic", codex: "openai", grok: "xai" };

/** True when an account of provider `account` can serve a model whose provider is `wanted`. */
export function sameProviderFamily(account: string, wanted: string): boolean {
  // one provider is spelled "opencode-go" by the Vault and "opencode_go" by the model list: an own account is never passed over for a spelling (owner, 6 Nov: the Space account beat the person's own)
  const norm = (p: string): string => { const k = p.toLowerCase().replace(/_/g, "-"); return FAMILY[k] ?? k; };
  return norm(account) === norm(wanted);
}
