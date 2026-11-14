// The one list of slash commands a chat offers. The composer's / menu, the server's composer table (chat.composer.suggest) and the code that runs a command all read this list, so a command
// that is offered is a command that runs. Plugin commands are added on top by the app; they never replace one of these.

export interface ChatCommandDef {
  /** What follows the slash. */
  id: string;
  /** One line in the menu. */
  detail: string;
  /** The heading it sits under in the menu. */
  group: ChatCommandGroup;
  /** The argument the command takes, as the hint after the name; absent when it takes none. Present: the menu inserts "/id " and waits for the words. */
  arg?: string;
  /** The command cannot run without its argument. */
  argRequired?: boolean;
}

/** The group a command sits under in the menu (the prototype's headings). */
export type ChatCommandGroup =
  | "While it works"
  | "Bring in help"
  | "How it runs"
  | "This session"
  | "Keep it"
  | "Set it up";

export const CHAT_COMMANDS: readonly ChatCommandDef[] = Object.freeze([
  // While it works
  {
    id: "btw",
    group: "While it works",
    detail: "Ask a side question while the agent works",
    arg: "your question",
    argRequired: true,
  },
  { id: "stop", group: "While it works", detail: "Stop what the agent is doing" },
  { id: "find", group: "While it works", detail: "Find words in this chat" },
  // Bring in help
  {
    id: "helper",
    group: "Bring in help",
    detail: "Start a helper chat for a side task",
    arg: "what it should do",
    argRequired: true,
  },
  {
    id: "handoff",
    group: "Bring in help",
    detail: "Hand the work to another agent",
    arg: "@agent and a note",
    argRequired: true,
  },
  { id: "review", group: "Bring in help", detail: "A helper reviews the work", arg: "what to look at" },
  { id: "security-review", group: "Bring in help", detail: "A helper reviews it for security" },
  { id: "agents", group: "Bring in help", detail: "Who is working in this chat" },
  // How it runs
  { id: "model", group: "How it runs", detail: "Choose the model this chat answers with" },
  { id: "effort", group: "How it runs", detail: "How hard it thinks" },
  { id: "plan", group: "How it runs", detail: "Plan first: turn plan mode on or off", arg: "on or off" },
  { id: "permissions", group: "How it runs", detail: "See what runs without asking", arg: "remove and a number" },
  // This session
  { id: "new", group: "This session", detail: "Start a fresh chat with this agent" },
  { id: "context", group: "This session", detail: "What this chat runs on, and what is left" },
  { id: "compact", group: "This session", detail: "Free up context, keeping what you name", arg: "what to keep" },
  { id: "fork", group: "This session", detail: "Branch this chat into a new one" },
  { id: "export", group: "This session", detail: "Save this chat as Markdown or JSON", arg: "md or json" },
  { id: "search", group: "This session", detail: "Search every chat you can read", arg: "words" },
  // Keep it
  {
    id: "task",
    group: "Keep it",
    detail: "Make a task from the last message",
    arg: "a title, if the message is not it",
  },
  {
    id: "remember",
    group: "Keep it",
    detail: "Keep a fact in your memory of this agent",
    arg: "the fact",
    argRequired: true,
  },
  { id: "memory", group: "Keep it", detail: "What this agent knows" },
  { id: "pin", group: "Keep it", detail: "Pin the last message" },
  { id: "copy", group: "Keep it", detail: "Copy the last reply" },
  // Set it up
  { id: "skills", group: "Set it up", detail: "The skills you and this agent have" },
  { id: "hooks", group: "Set it up", detail: "What runs on its own in this chat" },
  { id: "init", group: "Set it up", detail: "Write AGENT.md for this project" },
] satisfies readonly ChatCommandDef[]);

/** Names people already know from other tools, and what they run here. */
export const CHAT_COMMAND_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  usage: "context",
  status: "context",
  cost: "context",
  "context-window": "context",
  clear: "new",
  quit: "stop",
  cancel: "stop",
  approvals: "permissions",
  "code-review": "review",
  "review-pr": "review",
});

export type ChatCommandId =
  | "btw"
  | "stop"
  | "find"
  | "helper"
  | "handoff"
  | "review"
  | "security-review"
  | "agents"
  | "model"
  | "effort"
  | "plan"
  | "permissions"
  | "new"
  | "context"
  | "compact"
  | "fork"
  | "export"
  | "search"
  | "task"
  | "remember"
  | "memory"
  | "pin"
  | "copy"
  | "skills"
  | "hooks"
  | "init";

const BY_ID = new Map(CHAT_COMMANDS.map((c) => [c.id, c] as const));
export const chatCommand = (id: string): ChatCommandDef | undefined => BY_ID.get(id);

/**
 * A message that is a command: "/plan", "/helper write the brief". Only a known name counts, and only at the very start; "/usr/bin" or "/ok then" is an ordinary message.
 * `extra` holds the names of plugin commands the caller also accepts.
 */
export function parseSlash(
  text: string,
  extra: ReadonlySet<string> | readonly string[] = [],
): { id: string; arg: string } | null {
  const m = /^\/([a-z][a-z0-9_:-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  const said = (m[1] ?? "").toLowerCase();
  const plugin = extra instanceof Set ? extra.has(said) : (extra as readonly string[]).includes(said);
  // a plugin's own command of that name wins over a nickname of ours; a name of ours is never taken
  const id = plugin && !BY_ID.has(said) ? said : (CHAT_COMMAND_ALIASES[said] ?? said);
  const known = BY_ID.has(id) || plugin;
  return known ? { id, arg: (m[2] ?? "").trim() } : null;
}
