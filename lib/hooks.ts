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

/** What a check model said, read: ALLOW, BLOCK: <reason>, or NOTE: <text>. Anything it cannot read is allow (a check never blocks on a muddle). */
export type CheckAnswer = { decision: "allow" } | { decision: "block"; reason: string } | { decision: "note"; note: string };
export function parseCheck(text: string): CheckAnswer {
  const t = text.trim();
  const m = /^(allow|block|note)\b\s*[:\-]?\s*([\s\S]*)$/i.exec(t.replace(/^[*`"'\s]+/, ""));
  if (!m) return { decision: "allow" };
  const word = m[1]!.toLowerCase();
  const rest = m[2]!.trim().split("\n")[0]!.slice(0, 300).trim();
  if (word === "block") return { decision: "block", reason: rest === "" ? "a check said no" : rest };
  if (word === "note" && rest !== "") return { decision: "note", note: rest };
  return { decision: "allow" };
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
  const when = e === "tool.before" || e === "tool.after" ? `${EVENT_WORDS[e]} ${h.matcher && h.matcher !== "*" ? h.matcher : "any tool"}` : EVENT_WORDS[e] ?? h.event;
  const what = h.kind === "check" ? `check: ${(h.instruction ?? "").trim()}` : h.kind === "action" ? `run ${h.cap ?? "an action"}` : `run ${(h.command ?? "a command").split(/\s+/)[0]}`;
  return `${when}, ${what}`.slice(0, 200);
}
