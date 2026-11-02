// Does a pasted API key look like the provider chosen for it? Keys carry their maker's prefix (Anthropic sk-ant-, OpenRouter sk-or-, xAI xai-, Google AIza, OpenAI sk-), so a key
// pasted under the wrong provider is caught before it is saved, with the right one to switch to. OpenCode Go keys carry no prefix of their own, so a key with none of these prefixes,
// chosen as one of the prefixed providers, suggests OpenCode Go. Pure, no imports, so the Console and setup share it.

const PREFIX: readonly { key: string; prefix: string }[] = [
  { key: "anthropic", prefix: "sk-ant-" },
  { key: "openrouter", prefix: "sk-or-" },
  { key: "xai", prefix: "xai-" },
  { key: "google", prefix: "AIza" },
  { key: "openai", prefix: "sk-" },
];

/** The provider a key's prefix names, most specific first; null when it has none we know. */
export function providerOfKey(value: string): string | null {
  const v = value.trim();
  return PREFIX.find((p) => v.startsWith(p.prefix))?.key ?? null;
}

/** "an OpenRouter", "an xAI", "a Google": the article as the name is said. */
const an = (name: string): string => `${/^[aeiouxAEIOU]/.test(name) ? "an" : "a"} ${name}`;

export interface KeyCheck { line: string; suggest: string | null }

/** Null when the key fits the chosen provider (or nothing is typed); else the line to show and the provider to switch to, if one is offered. */
export function checkKey(chosen: string, value: string, titleOf: (key: string) => string | null): KeyCheck | null {
  const v = value.trim();
  if (v.length < 6) return null;
  const guess = providerOfKey(v);
  const want = PREFIX.find((p) => p.key === chosen)?.prefix;
  const name = titleOf(chosen) ?? chosen;
  if (guess && guess !== chosen) {
    // a plain sk- key under OpenCode Go may well be its own: only a more specific prefix is a mismatch there
    if (chosen === "opencode-go" && guess === "openai") return null;
    const other = titleOf(guess);
    return other ? { line: `This looks like ${an(other)} key (it starts with ${PREFIX.find((p) => p.key === guess)!.prefix}), not ${name}.`, suggest: guess } : { line: `This does not look like ${an(name)} key.`, suggest: null };
  }
  if (want && !guess) {
    const oc = titleOf("opencode-go");
    return { line: `${name} keys start with ${want}.${oc ? ` Is this ${an(oc)} key?` : ""}`, suggest: oc ? "opencode-go" : null };
  }
  return null;
}
