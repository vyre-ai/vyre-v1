// What a person reads for a model and an account (owner, 5 Nov 2026): "Opus 5.5" and "Maya Claude", never a vendor slug ("claude-opus-5-5"), an engine ("claude-code") or a vault handle ("Maya_Claude").

const CAP = (w: string): string => (w === "" ? w : w[0]!.toUpperCase() + w.slice(1));

/** claude-opus-5-5 becomes Opus 5.5, gpt-6 GPT-6, glm-5.3-flash GLM 5.3 Flash, deepseek-v4.1-flash DeepSeek V4.1 Flash. An unknown slug is read as words. */
export function modelName(slug: string | undefined): string {
  if (!slug) return "";
  const s = slug.replace(/^(?:anthropic|openai|z-ai|zai)\//i, "").trim();
  let m = /^(?:claude-)?(opus|sonnet|haiku|fable)-(\d+)(?:[-.](\d+))?/i.exec(s);
  if (m) return `${CAP(m[1]!.toLowerCase())} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
  m = /^gpt-?(\d+(?:\.\d+)?)(?:-(codex|mini|nano|turbo))?/i.exec(s);
  if (m) return `GPT-${m[1]}${m[2] ? ` ${CAP(m[2].toLowerCase())}` : ""}`;
  m = /^glm-?(\d+(?:\.\d+)?)(?:-(flash|air|plus|turbo))?/i.exec(s);
  if (m) return `GLM ${m[1]}${m[2] ? ` ${CAP(m[2].toLowerCase())}` : ""}`;
  m = /^deepseek-?v?(\d+(?:\.\d+)?)(?:-(flash|pro|chat|reasoner))?/i.exec(s);
  if (m) return `DeepSeek V${m[1]}${m[2] ? ` ${CAP(m[2].toLowerCase())}` : ""}`;
  return s.split(/[-_/]/).filter((w) => w !== "").map((w) => (/^\d/.test(w) ? w : CAP(w))).join(" ");
}

/** "claude-code · Maya_Claude" becomes "Maya Claude": the engine is dropped, a handle's underscores are spaces. */
export function accountName(label: string | undefined): string {
  if (!label) return "";
  const parts = label.split("·").map((p) => p.trim()).filter((p) => p !== "");
  const named = parts.filter((p) => !/^(claude-code|codex|claude|chatgpt|opencode-go|anthropic|openai)$/i.test(p));
  return (named.length > 0 ? named[named.length - 1]! : parts[parts.length - 1] ?? "").replace(/^#/, "").replace(/_/g, " ").trim();
}
