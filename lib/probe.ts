// Agents never call a tool to see if it works, and never post placeholder content (owner, 4 Nov 2026: "Agents shouldnt be throwing random test boxes or example.com boxes/cards in chat. That kills the trust").
// A call whose arguments are placeholders is refused before it runs, so nothing reaches the chat: no card, no hold, no task, no message. The model gets a plain sentence back.

export const PROBE_MESSAGE = "Don't call tools to test them. Call with the real thing the person asked for, or don't call.";
export const PROBE_RULE = "Never call a tool to see if it works, and never post placeholder or test content. If you can't do something, say so in one sentence.";

const WHOLE = /^(?:test|testing|tests|test\s?\d*|foo|bar|foo\s+bar|foobar|baz|asdf|qwerty|xxx|placeholder|dummy|sample|example|todo|tbd|n\/a|none|null|undefined|lorem(?:\s+ipsum)?)$/i;
const HOST = /\b(?:[a-z0-9-]+\.)*example\.(?:com|org|net)\b/i;
const PROBE_ID = /(?:^|_)(?:probe|none|nonexistent|nothing|fake|dummy)(?:_|$)|^[a-z]{2,6}_(?:test|example|placeholder)\w*$/i;
const LOREM = /lorem ipsum/i;
/** Search arguments may be any words: someone can ask for "test". */
const FREE = new Set(["q", "query", "search", "term", "pattern", "filter", "keyword", "keywords", "text_search"]);

/** The placeholder in a value, as the words that show it, or null. Walks objects and lists; a field named for searching is left alone. */
export function probeIn(v: unknown, key = "", said = ""): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    // a value the person typed themselves is theirs to ask for ("make a task called test", "open example.com")
    const mine = (what: string): boolean => said !== "" && said.toLowerCase().includes(what.toLowerCase());
    if (FREE.has(key)) return null;
    if (s === "") return null;   // an empty required field is the schema's refusal, with its own message
    if (/__probe/i.test(s)) return s;
    if (WHOLE.test(s)) return mine(s) ? null : s;
    if (LOREM.test(s)) return mine(s) ? null : s;
    const host = HOST.exec(s);
    if (host) return mine(host[0]) ? null : s;
    if (s.length < 80 && !s.includes(" ") && PROBE_ID.test(s)) return mine(s) ? null : s;
    return null;
  }
  if (Array.isArray(v)) { for (const x of v) { const p = probeIn(x, key, said); if (p !== null) return p; } return null; }
  if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "idempotencyKey") continue;
      const p = probeIn(x, k, said);
      if (p !== null) return p;
    }
  }
  return null;
}
