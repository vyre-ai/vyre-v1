// The one list of slash commands a chat offers. The composer's / menu, the server's composer table (chat.composer.suggest) and the code that runs a command all read this list, so a command
// that is offered is a command that runs. Plugin commands are added on top by the app; they never replace one of these.

export interface ChatCommandDef {
  /** What follows the slash. */
  id: string;
  /** One line in the menu. */
  detail: string;
  /** The argument the command takes, as the hint after the name; absent when it takes none. Present: the menu inserts "/id " and waits for the words. */
  arg?: string;
  /** The command cannot run without its argument. */
  argRequired?: boolean;
}

export const CHAT_COMMANDS: readonly ChatCommandDef[] = Object.freeze([
  { id: "btw", detail: "Ask a side question while the agent works", arg: "your question", argRequired: true },
  { id: "plan", detail: "Turn plan mode on or off for this chat", arg: "on or off" },
  { id: "helper", detail: "Start a helper chat for a side task", arg: "what it should do", argRequired: true },
  { id: "handoff", detail: "Hand the work to another agent", arg: "@agent and a note", argRequired: true },
  { id: "pin", detail: "Pin the last message" },
  { id: "fork", detail: "Branch this chat into a new one, from the last message" },
  { id: "export", detail: "Save this chat as Markdown or JSON", arg: "md or json" },
  { id: "continue", detail: "Continue this chat in another Space you belong to", arg: "the Space's name", argRequired: true },
  { id: "task", detail: "Make a task from the last message", arg: "a title, if the message is not it" },
  { id: "remember", detail: "Keep a fact in your memory of this agent", arg: "the fact", argRequired: true },
  { id: "find", detail: "Find words in this chat" },
  { id: "search", detail: "Search every chat you can read", arg: "words" },
  { id: "model", detail: "Choose the model this chat answers with" },
  { id: "stop", detail: "Stop what the agent is doing" },
] satisfies readonly ChatCommandDef[]);

export type ChatCommandId = "plan" | "helper" | "handoff" | "pin" | "fork" | "export" | "continue" | "task" | "remember" | "find" | "search" | "model" | "btw" | "stop";

const BY_ID = new Map(CHAT_COMMANDS.map((c) => [c.id, c] as const));
export const chatCommand = (id: string): ChatCommandDef | undefined => BY_ID.get(id);

/**
 * A message that is a command: "/plan", "/helper write the brief". Only a known name counts, and only at the very start; "/usr/bin" or "/ok then" is an ordinary message.
 * `extra` holds the names of plugin commands the caller also accepts.
 */
export function parseSlash(text: string, extra: ReadonlySet<string> | readonly string[] = []): { id: string; arg: string } | null {
  const m = /^\/([a-z][a-z0-9_:-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  const id = (m[1] ?? "").toLowerCase();
  const known = BY_ID.has(id) || (extra instanceof Set ? extra.has(id) : (extra as readonly string[]).includes(id));
  return known ? { id, arg: (m[2] ?? "").trim() } : null;
}
