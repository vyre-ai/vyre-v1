// A reply's hover card and Details tab (owner, 3 Nov 2026), as plain lines from chat.reply_details. Every value is read from the stored turn record: nothing is estimated here, and a
// value the provider did not send says "Not reported by <provider>", never 0. In a shared chat the account, the cost and the tool arguments come back only for the asker and the
// people who manage AI spend; everyone else reads "On <asker>'s account".

export interface ReplyCost { source: "subscription" | "reported" | "catalog" | "unknown"; micros?: number; lines?: Array<{ kind: "input" | "output" | "cache_read" | "cache_write"; tokens: number; perMillion: number; micros: number }>; priceAsOf?: string; missing?: string[] }
export interface ReplyTurn {
  turnId: string; traceId: string; agentId: string; asker: string; model: string; effort?: string; engine: string; provider?: string;
  accountKind?: "api_key" | "subscription"; shared?: boolean; accountRef?: string; paid?: string; state: string;
  ranOn: Array<{ kind: string; name: string }>;
  timing: { queuedAt?: number; startedAt: number; firstTokenAt?: number; endedAt?: number };
  tokens: { in: number; out: number; context?: number; cacheRead?: number; cacheWrite?: number; reasoning?: number };
  cost?: ReplyCost;
  tools: Array<{ name: string; args?: string; ok?: boolean; durationMs?: number; heldTaskId?: string }>;
  files: { read: string[]; written: string[] }; skills: string[];
  switches: Array<{ at: number; why: string; sameAccount: boolean; from?: string; to?: string }>;
  error?: { code: string; message: string };
  private: boolean; partial: boolean;
}
export interface ReplyDetails {
  messageId: string; threadId: string; agentId: string; at: number;
  turn?: ReplyTurn;
  memory?: { facts: Array<{ factId: string; text: string; sourceTitle?: string }>; quotes: Array<{ ref: string; text: string; threadTitle?: string; at: number }> };
  steps: Array<{ name: string; ok?: boolean; secs?: number }>;
}

export interface DetailsContext {
  meId: string;
  nameOf(id: string): string;
  /** The name of an AI account the reader can see (engine.accounts.list), by its ref. */
  accountName?(ref: string): string | undefined;
}

/** One line of the card or the tab: a section heading, a label and its value (with a copy button for an id), or an item of a list. */
export type Line =
  | { kind: "label"; key: string; text: string; right?: string }
  | { kind: "kv"; key: string; label: string; value: string; copy?: string; muted?: boolean; /** in grey after the value: whose account it is */ note?: string }
  | { kind: "item"; key: string; title: string; note?: string; right?: string; icon: "file" | "lock" | "check" | "x" | "clock" | "doc" | "copy" | "bubble"; open?: string }
  | { kind: "note"; key: string; text: string };

const PROVIDERS: Record<string, string> = {
  anthropic: "Anthropic", claude_code: "Claude Code", codex: "Codex", grok: "Grok", openai: "OpenAI", openrouter: "OpenRouter", opencode_go: "OpenCode Go",
  google: "Google", xai: "xAI", local: "Local model", custom: "Custom endpoint",
};
/** The plan a sign-in belongs to, by engine. */
const PLANS: Record<string, string> = { claude_code: "Claude", codex: "ChatGPT", grok: "Grok" };

export const providerName = (key: string | undefined): string => (key ? PROVIDERS[key] ?? key : "the provider");
/** Who to name in "Not reported by …": the engine when the turn ran on one (Claude Code, Codex), else the provider. */
export const reporterOf = (t: ReplyTurn): string => providerName(PROVIDERS[t.engine] && t.engine !== "anthropic" && t.engine !== "openai" ? t.engine : t.provider ?? t.engine);
const notReported = (t: ReplyTurn): string => `Not reported by ${reporterOf(t)}`;

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** The model's real name: claude-opus-5-5 is Claude Opus 5.5, gpt-6.1-sol is GPT-6.1 Sol; a name it does not know is shown as it is. */
export function modelTitle(id: string): string {
  if (id === "") return "Not recorded";
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id);
  if (claude) return `Claude ${cap(claude[1]!)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  const gpt = /^gpt-([\d.]+)(?:-([a-z]+))?$/.exec(id);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${cap(gpt[2])}` : ""}`;
  const grok = /^grok-([\d.]+)$/.exec(id);
  if (grok) return `Grok ${grok[1]}`;
  return id;
}

/** Dollars from micros: three places under a dollar, so a small turn is not rounded to nothing. */
export function usd(micros: number): string {
  const d = micros / 1e6;
  return d >= 1 ? `$${d.toFixed(2)}` : `$${d.toFixed(3)}`;
}
export const count = (n: number): string => n.toLocaleString("en-US");
export const short = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
export function took(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) { const m = Math.floor(s / 60), r = Math.round(s % 60); return r ? `${m} min ${r} s` : `${m} min`; }
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

const first = (name: string): string => name.split(/\s+/)[0] ?? name;
const asker = (t: ReplyTurn, c: DetailsContext): string => (t.asker === c.meId ? "You" : c.nameOf(t.asker));

/** The AI account in words: its name when the reader can see it, else what kind it is. Someone who may not see it reads whose account it was. */
export function accountLine(t: ReplyTurn, c: DetailsContext): string {
  if (t.private) return `On ${first(c.nameOf(t.asker))}'s account`;
  const named = t.accountRef ? c.accountName?.(t.accountRef) : undefined;
  if (named) return named;
  const who = t.asker === c.meId ? "Your" : `${first(c.nameOf(t.asker))}'s`;
  if (t.accountKind === "subscription") return `${who} ${PLANS[t.engine] ?? providerName(t.provider)} sign-in`;
  if (t.accountKind === "api_key") return t.shared ? `${providerName(t.provider)} · Team key` : `${who} ${providerName(t.provider)} key`;
  return "Not recorded";
}

/**
 * The one "Paid by" row: the account's name, and in grey after it whose it is ("OpenCode Go", "Space account"). The stored line is "<name> \u00b7 <whose>"; one from before that wording has no
 * separator, so only the account's own name is shown. Someone who may not see the account reads whose it was.
 */
export function paidBy(t: ReplyTurn, c: DetailsContext): { value: string; note?: string } {
  if (t.private) return { value: accountLine(t, c) };
  const i = t.paid ? t.paid.indexOf(" \u00b7 ") : -1;
  if (t.paid && i >= 0) return { value: (t.accountRef ? c.accountName?.(t.accountRef) : undefined) ?? t.paid.slice(0, i), note: t.paid.slice(i + 3) };
  return { value: accountLine(t, c) };
}

/** What the turn cost, in one line. */
export function costLine(t: ReplyTurn, c: DetailsContext): string {
  const k = t.cost;
  if (!k) return "Not recorded";
  if (k.source === "subscription") return `Included in ${t.asker === c.meId ? "your" : `${first(c.nameOf(t.asker))}'s`} ${PLANS[t.engine] ?? providerName(t.provider)} plan`;
  if (k.source === "unknown" || k.micros === undefined) return notReported(t);
  return k.missing && k.missing.length > 0 ? `${usd(k.micros)} and unpriced cache writes` : usd(k.micros);
}

/**
 * The card's tokens in one line. A turn's input adds up every call it made, and most of it is the same context read from the cache again, so new input and cached input are counted apart:
 * "62k new in · 940k cached · 8.3k out". Without the provider's split, the total as it is.
 */
export function tokensLine(t: ReplyTurn): string {
  const cached = (t.tokens.cacheRead ?? 0) + (t.tokens.cacheWrite ?? 0);
  if (t.tokens.cacheRead === undefined && t.tokens.cacheWrite === undefined) return `${short(t.tokens.in)} in · ${short(t.tokens.out)} out`;
  return `${short(Math.max(0, t.tokens.in - cached))} new in · ${short(cached)} cached · ${short(t.tokens.out)} out`;
}

export const ranOnLine = (t: ReplyTurn): string => (t.ranOn.length > 0 ? t.ranOn.map((r) => r.name).join(", then ") : "The Space");
const durationOf = (t: ReplyTurn): string => (t.timing.endedAt !== undefined ? took(t.timing.endedAt - t.timing.startedAt) : "Still working");

/** The hover card: who answered on what, for whom, where, at what cost, in how many tokens and how long. */
export function cardLines(d: ReplyDetails, c: DetailsContext): { head: string; sub: string; lines: Line[] } {
  const t = d.turn;
  const head = c.nameOf(d.agentId);
  if (!t) return { head, sub: "Not recorded for this reply", lines: [{ kind: "note", key: "none", text: "Vyre did not keep the details of this reply. Newer replies have them." }] };
  const lines: Line[] = [
    { kind: "kv", key: "asker", label: "Asked by", value: asker(t, c) },
    ((p) => ({ kind: "kv" as const, key: "paid", label: "Paid by", value: p.value, ...(p.note ? { note: p.note } : {}) }))(paidBy(t, c)),
    { kind: "kv", key: "ran", label: "Ran on", value: ranOnLine(t) },
    ...(t.private ? [] : [{ kind: "kv" as const, key: "cost", label: "Cost", value: costLine(t, c) }]),
    { kind: "kv", key: "tokens", label: "Tokens", value: tokensLine(t) },
    { kind: "kv", key: "took", label: "Took", value: durationOf(t) },
  ];
  return { head, sub: t.effort ? `${modelTitle(t.model)} · ${cap(t.effort)} effort` : modelTitle(t.model), lines };
}

const label = (key: string, text: string, right?: number): Line => ({ kind: "label", key, text, ...(right === undefined ? {} : { right: String(right) }) });

const WHY: Record<string, string> = {
  "provider.overloaded": "the provider was busy", "provider.rate_limited": "a usage limit was reached", "provider.auth_failed": "the sign-in stopped working", "auth.expired": "the sign-in expired",
};
const COST_KIND: Record<string, string> = { input: "Input", output: "Output", cache_read: "Cache read", cache_write: "Cache write" };
const COPY: Record<string, string> = { msg: "message", turn: "turn", trace: "trace" };

/** The Details tab, top to bottom: ids, who and where, timing, tokens, cost, tools, what the agent knew, skills, files, errors and retries. */
export function detailLines(d: ReplyDetails, c: DetailsContext): Line[] {
  const t = d.turn;
  const out: Line[] = [];
  const kv = (key: string, label: string, value: string, more: Partial<Extract<Line, { kind: "kv" }>> = {}): void => { out.push({ kind: "kv", key, label, value, ...more }); };
  out.push({ kind: "label", key: "ids", text: "IDs" });
  kv("id-msg", "Message", d.messageId, { copy: COPY.msg! });
  if (t) { kv("id-turn", "Turn", t.turnId, { copy: COPY.turn! }); kv("id-trace", "Trace", t.traceId, { copy: COPY.trace! }); }
  if (!t) {
    out.push({ kind: "note", key: "none", text: "Vyre did not keep the details of this reply: it was made before they were recorded, or its turn could not be found. What the reply saved itself is below." });
    out.push({ kind: "label", key: "steps", text: "Steps", right: String(d.steps.length) });
    for (const [i, s] of d.steps.entries()) out.push({ kind: "item", key: `step-${i}`, title: s.name, icon: s.ok === false ? "x" : "check", ...(s.secs !== undefined ? { right: `${s.ok === false ? "Failed" : "Done"} · ${s.secs} s` } : {}) });
    knew(d, out);
    return out;
  }
  const rep = notReported(t);
  out.push({ kind: "label", key: "who", text: "Who and where" });
  kv("asker", "Asked by", asker(t, c));
  kv("agent", "Agent", c.nameOf(t.agentId));
  kv("model", "Model", modelTitle(t.model));
  kv("effort", "Effort", t.effort ? cap(t.effort) : "The model's default");
  const pb = paidBy(t, c);
  kv("paid", "Paid by", pb.value, pb.note ? { note: pb.note } : {});
  kv("provider", "Provider", t.provider && PROVIDERS[t.engine] && t.engine !== t.provider ? `${providerName(t.provider)} · ${providerName(t.engine)}` : providerName(t.provider ?? t.engine));
  if (t.ranOn.length > 1) t.ranOn.forEach((r, i) => kv(`ran-${i}`, i === 0 ? "Ran on" : "Then", r.name));
  else kv("ran", "Ran on", ranOnLine(t));

  out.push({ kind: "label", key: "timing", text: "Timing" });
  kv("queued", "Queued", t.timing.queuedAt !== undefined ? took(t.timing.startedAt - t.timing.queuedAt) : "Not recorded", t.timing.queuedAt === undefined ? { muted: true } : {});
  kv("first", "First token", t.timing.firstTokenAt !== undefined ? took(t.timing.firstTokenAt - t.timing.startedAt) : t.partial ? "Not recorded" : "No words or thoughts", t.timing.firstTokenAt === undefined ? { muted: true } : {});
  kv("total", "Total", durationOf(t));

  out.push({ kind: "label", key: "tokens", text: "Tokens" });
  const cachedIn = (t.tokens.cacheRead ?? 0) + (t.tokens.cacheWrite ?? 0);
  kv("in", t.tokens.cacheRead === undefined && t.tokens.cacheWrite === undefined ? "In" : "New input", count(Math.max(0, t.tokens.in - cachedIn)));
  if (t.tokens.context !== undefined) kv("context", "Context in the last call", count(t.tokens.context));
  kv("out", "Out", count(t.tokens.out));
  for (const [key, label, v] of [["cache-read", "Cache read", t.tokens.cacheRead], ["cache-write", "Cache write", t.tokens.cacheWrite], ["reasoning", "Reasoning", t.tokens.reasoning]] as const) {
    kv(key, label, v === undefined ? (t.partial ? "Not recorded" : rep) : count(v), v === undefined ? { muted: true } : {});
  }

  out.push({ kind: "label", key: "cost", text: "Cost" });
  if (t.private) out.push({ kind: "note", key: "cost-private", text: `Only ${first(c.nameOf(t.asker))} and the people who manage AI spend see the account and the cost.` });
  else if (!t.cost || t.cost.source === "subscription" || t.cost.source === "unknown") {
    kv("cost-total", "This turn", costLine(t, c), t.cost?.source === "unknown" || !t.cost ? { muted: true } : {});
    if (t.cost?.source === "subscription") out.push({ kind: "note", key: "cost-plan", text: "A sign-in is not billed per token, so there is no dollar figure." });
  } else {
    for (const l of t.cost.lines ?? []) kv(`cost-${l.kind}`, COST_KIND[l.kind]!, `${usd(l.micros)} · ${count(l.tokens)} at $${l.perMillion.toFixed(2)}/M`);
    for (const m of t.cost.missing ?? []) kv(`cost-${m}`, COST_KIND[m] ?? m, "Not in the price list", { muted: true });
    kv("cost-total", "Total", t.cost.micros !== undefined ? usd(t.cost.micros) : rep);
    out.push({ kind: "note", key: "cost-src", text: t.cost.source === "reported" ? `Priced by ${reporterOf(t)} itself.` : `${providerName(t.provider)} list price on ${t.cost.priceAsOf ?? "the day of the turn"}.` });
  }

  out.push({ kind: "label", key: "tools", text: "Tools used", right: String(t.tools.length) });
  if (t.tools.length === 0) out.push({ kind: "note", key: "tools-none", text: t.partial ? "Not recorded." : "No tools." });
  for (const [i, x] of t.tools.entries()) {
    const note = [t.private ? "Arguments hidden" : x.args, x.heldTaskId ? "Held for a yes, then allowed" : undefined].filter(Boolean).join(" · ");
    out.push({
      kind: "item", key: `tool-${i}`, title: x.name, ...(note ? { note } : {}), icon: x.heldTaskId ? "lock" : x.ok === false ? "x" : "check",
      right: `${x.ok === false ? "Failed" : x.ok === undefined ? "Did not finish" : "Done"}${x.durationMs !== undefined ? ` · ${took(x.durationMs)}` : ""}`,
    });
  }
  knew(d, out);

  out.push({ kind: "label", key: "skills", text: "Skills loaded", right: String(t.skills.length) });
  if (t.skills.length === 0) out.push({ kind: "note", key: "skills-none", text: t.engine === "claude_code" ? "None." : `${rep}.` });
  for (const s of t.skills) out.push({ kind: "item", key: `skill-${s}`, title: s, icon: "doc" });

  out.push(label("files", "Files", t.private ? undefined : t.files.read.length + t.files.written.length));
  if (t.private) out.push({ kind: "note", key: "files-private", text: `Only ${first(c.nameOf(t.asker))} and the people who manage AI spend see which files it opened.` });
  else if (t.files.read.length + t.files.written.length === 0) out.push({ kind: "note", key: "files-none", text: "None read or written." });
  for (const f of t.private ? [] : t.files.written) out.push({ kind: "item", key: `w-${f}`, title: f, note: "Written", icon: "file", open: f });
  for (const f of t.private ? [] : t.files.read) out.push({ kind: "item", key: `r-${f}`, title: f, note: "Read", icon: "file", open: f });

  const problems = t.switches.length + (t.error ? 1 : 0);
  out.push(label("errors", "Errors and retries", problems > 0 ? problems : undefined));
  if (problems === 0) out.push({ kind: "note", key: "errors-none", text: "None." });
  for (const [i, s] of t.switches.entries()) {
    const why = WHY[s.why] ?? s.why;
    const text = s.sameAccount ? `Tried again on the same account: ${why}` : t.private || !s.from || !s.to ? `Moved to another AI account: ${why}` : `Moved from ${c.accountName?.(s.from) ?? s.from} to ${c.accountName?.(s.to) ?? s.to}: ${why}`;
    out.push({ kind: "item", key: `switch-${i}`, title: text, icon: "clock" });
  }
  if (t.error) out.push({ kind: "item", key: "error", title: t.error.message, note: t.error.code, icon: "x" });
  return out;
}

/** What the agent knew (it was "Show what the agent knew here" in the menu): what recall put in front of it for this reply, as the reader may see it. */
function knew(d: ReplyDetails, out: Line[]): void {
  const m = d.memory;
  const n = m ? m.facts.length + m.quotes.length : 0;
  out.push(label("knew", "What the agent knew", m ? n : undefined));
  if (!m) { out.push({ kind: "note", key: "knew-none", text: "Not recorded." }); return; }
  if (n === 0) out.push({ kind: "note", key: "knew-none", text: "Nothing from memory." });
  for (const f of m.facts) out.push({ kind: "item", key: `fact-${f.factId}`, title: f.text, ...(f.sourceTitle ? { note: f.sourceTitle } : {}), icon: "bubble" });
  for (const q of m.quotes) out.push({ kind: "item", key: `quote-${q.ref}`, title: q.text, ...(q.threadTitle ? { note: q.threadTitle } : {}), icon: "bubble" });
}
