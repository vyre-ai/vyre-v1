// Hooks, the parts that need no database (lane l-hooks): the events, the scopes and their order, how a matcher reads a name, how a check model's answer is read, and the words a hook is described in.
// One file so the engine, the MCP endpoint, the hooks module and the generated CLI config all agree.

export const HOOK_EVENTS = ["session.start", "prompt.submit", "tool.before", "tool.after", "outward.before", "turn.end", "helper.start", "helper.end"] as const;
export type HookEventName = (typeof HOOK_EVENTS)[number];
/** Broadest first. Space hooks (admins) run before person hooks, and so on down to the run. */
export const HOOK_SCOPES = ["space", "person", "agent", "chat", "run"] as const;
export type HookScope = (typeof HOOK_SCOPES)[number];
export const HOOK_KINDS = ["command", "check", "action"] as const;
export type HookKind = (typeof HOOK_KINDS)[number];
/** Events a hook can stop. The others only take notes and run actions. */
export const BLOCKING: ReadonlySet<string> = new Set<HookEventName>(["prompt.submit", "tool.before", "outward.before", "helper.start"]);
export const scopeRank = (s: string): number => HOOK_SCOPES.indexOf(s as HookScope);

/** The names Claude Code, Codex and Grok use for the events a CLI can report on its own (their built-in tools and subagents). */
export const CLI_EVENT: Readonly<Record<string, HookEventName>> = {
  SessionStart: "session.start", UserPromptSubmit: "prompt.submit", PreToolUse: "tool.before", PostToolUse: "tool.after", Stop: "turn.end", SubagentStart: "helper.start", SubagentStop: "helper.end",
};
export const CLI_NAME: Readonly<Record<HookEventName, string>> = {
  "session.start": "SessionStart", "prompt.submit": "UserPromptSubmit", "tool.before": "PreToolUse", "tool.after": "PostToolUse", "outward.before": "PreToolUse", "turn.end": "Stop", "helper.start": "SubagentStart", "helper.end": "SubagentStop",
};

/** A matcher against a tool name: empty or * is every tool; anything else is a pattern that must match the whole name. */
export function matches(matcher: string, name: string): boolean {
  if (matcher === "" || matcher === "*") return true;
  try { return new RegExp(`^(?:${matcher})$`).test(name); } catch { return false; }
}
/** A matcher is tried against each of these: the tool's name, its capability, and the family the capability belongs to (mail.send is in "mail"). */
export const namesOf = (o: { tool?: string; cap?: string }): string[] => {
  const out = new Set<string>();
  if (o.tool) out.add(o.tool);
  if (o.cap) { out.add(o.cap); out.add(o.cap.split(".")[0]!); }
  return [...out];
};

/** One step a check offers after it stops something: a short button label and the plain sentence pressing it sends to the assistant, as the person's own message. */
export interface NextStep { label: string; ask: string }
/** What a check model said, read: ALLOW, BLOCK: <reason> (with up to two "NEXT: <label> | <ask>" lines), or NOTE: <text>. Anything it cannot read is allow (a check never blocks on a muddle). */
export type CheckAnswer = { decision: "allow" } | { decision: "block"; reason: string; next?: NextStep[] } | { decision: "note"; note: string };
export function parseCheck(text: string): CheckAnswer {
  const t = text.trim();
  const m = /^(allow|block|note)\b\s*[:\-]?\s*([\s\S]*)$/i.exec(t.replace(/^[*`"'\s]+/, ""));
  if (!m) return { decision: "allow" };
  const word = m[1]!.toLowerCase();
  const lines = m[2]!.trim().split("\n");
  const rest = lines[0]!.slice(0, 300).trim();
  if (word === "block") {
    const next = validNext(lines.slice(1).map((l) => /^\s*next\s*[:\-]\s*(.+?)\s*\|\s*(.+)$/i.exec(l)).filter((x): x is RegExpExecArray => x !== null).map((x) => ({ label: x[1]!, ask: x[2]! })));
    return { decision: "block", reason: rest === "" ? "a check said no" : rest, ...(next.length > 0 ? { next } : {}) };
  }
  if (word === "note" && rest !== "") return { decision: "note", note: rest };
  return { decision: "allow" };
}

const SNAKE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;
/** A step is shown only when it reads as plain words: short, one line, no link, no tool name, no key-shaped text, no markdown. At most two. */
export function validNext(steps: ReadonlyArray<{ label: string; ask: string }>): NextStep[] {
  const out: NextStep[] = [];
  for (const raw of steps) {
    const label = raw.label.replace(/\s+/g, " ").trim(), ask = raw.ask.replace(/\s+/g, " ").trim();
    if (label.length < 2 || label.length > 40 || ask.length < 4 || ask.length > 200) continue;
    const bad = (x: string): boolean => /https?:|www\.|:\/\/|\[[^\]]*\]\(|[<>`{}\\]|@[a-z0-9._-]+\.[a-z]{2,}/i.test(x) || SNAKE.test(x) || redact(x, 1000) !== x;
    if (bad(label) || bad(ask)) continue;
    if (out.some((o) => o.label.toLowerCase() === label.toLowerCase())) continue;
    out.push({ label, ask });
    if (out.length === 2) break;
  }
  return out;
}

const SECRETS: RegExp[] = [
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/g, /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}=*/gi, /\b(?:ghp|gho|ghs|xox[abpr])[-_][A-Za-z0-9-]{16,}\b/g,
  /\b[A-Za-z0-9+\/]{40,}={0,2}\b/g, /\b[0-9a-f]{32,}\b/gi, /((?:password|secret|token|api[_-]?key)\s*[:=]\s*)\S+/gi,
];
/** No secret rides in a hook's words: a key-shaped string is cut out before a reason, a note or a log line is kept or shown. */
export function redact(text: string, max = 300): string {
  let out = text;
  for (const re of SECRETS) out = out.replace(re, (...a: unknown[]) => (typeof a[1] === "string" && /[:=]\s*$/.test(a[1]) ? `${a[1]}[hidden]` : "[hidden]"));
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

const EVENT_WORDS: Record<HookEventName, string> = {
  "session.start": "when a session starts", "prompt.submit": "before each message is read", "tool.before": "before", "tool.after": "after", "outward.before": "before anything leaves Vyre",
  "turn.end": "when a turn ends", "helper.start": "before a helper starts", "helper.end": "when a helper ends",
};
/** The plain sentence for a hook when its maker gave none: "before any tool, check ...". */
export function plainLine(h: { event: string; kind: string; matcher?: string; instruction?: string; cap?: string; command?: string }): string {
  const e = h.event as HookEventName;
  const only = h.matcher && h.matcher !== "*" ? ACTION_CHOICES.find((c) => c.matcher === h.matcher)?.title.toLowerCase() ?? actionWords(h.matcher) : "any action";
  const when = e === "tool.before" || e === "tool.after" ? `${EVENT_WORDS[e]} ${only}` : EVENT_WORDS[e] ?? h.event;
  const what = h.kind === "check" ? `check: ${(h.instruction ?? "").trim()}` : h.kind === "action" ? capWords(h.cap) : "run a script";
  return `${when}, ${what}`.slice(0, 200);
}

// What one hook event carries and what the hooks said (the hooks port of agent/src/tools/hooks.ts, answered by modules/hooks).
export interface HookFire {
  event: HookEventName;
  agentId: string;
  asker: string;
  threadId: string;
  turnId?: string;
  /** The thread is a helper's, or a chat's: helpers inherit the run hooks of the thread that started them. */
  threadKind?: string;
  /** Which kind of engine is running the turn: api, claude_code, codex, grok. */
  engine?: string;
  /** Where the event came from: the engine, Vyre's own tool session, or a CLI's own built-in tool (through the vyre-hook shim). */
  source?: "engine" | "tools" | "cli";
  tool?: string;
  cap?: string;
  input?: unknown;
  output?: unknown;
  ok?: boolean;
  prompt?: string;
  title?: string;
}
export interface HookVerdict {
  /** The first block, if any: the reason a person reads, who made the hook, and which. */
  block: { reason: string; hookId: string; by: string; scope: string; next?: Array<{ label: string; ask: string }> } | null;
  /** Lines to add to the model's context. */
  notes: string[];
  ran: number;
}

/** What a small model reads when it checks one hook rule against one event (modules/hooks/eval.ts and the engine's check both use it). */
export const CHECK_SYSTEM = "You check one rule against one event for a workspace assistant. Answer with one line: ALLOW, or BLOCK: <short reason a person can read>, or NOTE: <one short line for the assistant to keep in mind>. After a BLOCK you may add up to two lines, each NEXT: <a button label of a few words> | <one plain sentence the person would say to the assistant to get past this the right way>. Use plain words: no links, no tool names, no code. Do not explain. Never answer with a key, a password or any secret.";

/** "Only for" in plain words: what a hook on a tool event is limited to. Each choice maps to the matcher the server tests against a tool's name, its capability and its family (see namesOf). "Any action" is no limit. */
export const ACTION_CHOICES: ReadonlyArray<{ key: string; title: string; matcher: string }> = [
  { key: "any", title: "Any action", matcher: "" },
  { key: "email", title: "Sending an email", matcher: "mail\\.send|mail\\.send_as|resend\\.send_email|mailgun\\.send_email" },
  { key: "text", title: "Sending a text", matcher: "telephony\\.send_sms" },
  { key: "command", title: "Running a command", matcher: "Bash" },
  { key: "file", title: "Changing a file", matcher: "Edit|Write|MultiEdit|NotebookEdit" },
  { key: "link", title: "Opening a link", matcher: "WebFetch|WebSearch" },
  { key: "money", title: "Moving money", matcher: "stripe" },
];
/** The events a hook can be limited by action on: the ones that fire around a tool or an outward step. */
export const ACTION_EVENTS: ReadonlySet<string> = new Set(["tool.before", "tool.after", "outward.before"]);
export const matcherFor = (key: string): string => ACTION_CHOICES.find((c) => c.key === key)?.matcher ?? "";
/** The plain choice a stored matcher stands for, or "any" when it is none of them (a hook set elsewhere keeps its own matcher; the sheet only writes these). */
export const choiceFor = (matcher: string): string => ACTION_CHOICES.find((c) => c.matcher === matcher)?.key ?? "any";

const dotted = (name: string): string => (/^[a-z]+_/.test(name) ? name.replace("_", ".") : name);
/** A tool or capability name as an action in plain words ("sending an email"), or "an action" when it is none of the plain choices. Never the name itself. */
export function actionWords(name: string | undefined): string {
  if (!name) return "an action";
  for (const c of ACTION_CHOICES) {
    if (c.key === "any" || c.matcher === "") continue;
    if ([name, dotted(name), name.split(/[._]/)[0]!].some((n) => matches(c.matcher, n))) return c.title[0]!.toLowerCase() + c.title.slice(1);
  }
  return "an action";
}
/** Any snake_case or dotted tool name inside a sentence swapped for plain words, so a name from the system never shows in a hook's words. */
export function plainTools(text: string): string {
  return text
    .replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b(?!\.[a-z])/g, (n) => actionWords(n))
    .replace(/\b(?:mail|chat|files|stripe|telephony|resend|mailgun|records|tasks|vault)\.[a-z_]+\b/g, (n) => actionWords(n));
}
/** A capability an action hook calls, in plain words. */
export function capWords(cap: string | undefined): string {
  if (!cap) return "an action";
  if (cap === "chat.post") return "post in the chat";
  const w = actionWords(cap);
  return w === "an action" ? "an action" : w;
}
