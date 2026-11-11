// One name for a chat, the same wherever it is shown (owner rule, 4 Nov 2026): the sidebar, the header, the tabs, search and notifications all ask this file.
//   1. A direct message with a person is named after that person.
//   2. Any other chat is named by its title. Until it has a real title it shows the other people in it ("Dex", "Dex and Aliza").
//   3. The title is made automatically after the first real request, never from a greeting. 2 to 5 plain words. It is made again once if the first one came from a thin request, and never after a person renames the chat.

/** What an untitled chat is stored as. */
export const PLACEHOLDER_TITLES: ReadonlySet<string> = new Set(["", "New chat", "Chat", "Untitled"]);
export const hasRealTitle = (title: string | null | undefined): title is string => typeof title === "string" && !PLACEHOLDER_TITLES.has(title.trim());

export interface NameInput {
  title?: string | null | undefined;
  /** The kind of chat; a channel or any other kind is named by its title alone. */
  kind?: string | undefined;
  /** The agents in the chat, by id. */
  agents: readonly string[];
  /** The other people in the chat (never the viewer), by id. */
  people: readonly string[];
}

/** "Dex", "Dex and Aliza", "Dex, Aliza and Omar", "Dex, Aliza, Omar and 2 more". */
export function joinNames(names: readonly string[]): string {
  const n = names.filter((x) => x !== "");
  if (n.length <= 1) return n[0] ?? "";
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  if (n.length === 3) return `${n[0]}, ${n[1]} and ${n[2]}`;
  return `${n[0]}, ${n[1]}, ${n[2]} and ${n.length - 3} more`;
}

/** The person a direct message is with: a chat with no agent and exactly one other person. */
export function directPerson(t: Pick<NameInput, "kind" | "agents" | "people">): string | null {
  return (t.kind === undefined || t.kind === "chat") && t.agents.length === 0 && t.people.length === 1 ? t.people[0]! : null;
}

/** The one name of a chat. `nameOf` turns an id into a person's or agent's name. */
export function chatName(t: NameInput, nameOf: (id: string) => string): string {
  const dm = directPerson(t);
  if (dm !== null) return nameOf(dm);
  if (hasRealTitle(t.title)) return t.title.trim();
  const others = joinNames([...t.agents, ...t.people].map(nameOf));
  return others === "" ? "Chat" : others;
}

// ---- making a title

const GREETING = /^(?:h+e+y+|h+i+|h+e+l+o+|yo+|sup|hola|howdy|good (?:morning|afternoon|evening)|gm|test(?:ing)?(?: \d+)?|ping|are you there|anyone there|you there|hello there|hey there|hi there)(?:\s+(?:there|again|dex|team|everyone|all|assistant|mira|vyre|claude))?$/i;
const ACK = /^(?:ok(?:ay)?|k|thanks?|thank you|thx|ty|yes|yep|yeah|no|nope|sure|great|cool|nice|done|perfect|good|fine|got it|sounds good|lgtm|please|go ahead|do it)$/i;

/** Small talk: a greeting, a test, an acknowledgement, a line with nothing in it. No title comes from it. */
export function isSmallTalk(text: string): boolean {
  const t = text.toLowerCase().replace(/@\w[\w.-]*/g, " ").replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();
  if (t.length < 3) return true;
  return GREETING.test(t) || ACK.test(t);
}

const words = (text: string): string[] => text.replace(/@\w[\w.-]*/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/[^\p{L}\p{N}\s'&-]/gu, " ").split(/\s+/).filter((w) => w !== "");

/** A request too thin to name a chat well ("test chat", "help me"): the title made from it is made again once a fuller request comes. */
export const isThin = (text: string): boolean => words(text).length < 4;

/** The first request in a chat's messages: the first line a person wrote that is not small talk. Null when there is none yet. */
export function firstRequest(lines: readonly { person: boolean; body: string }[]): string | null {
  return lines.find((l) => l.person && !isSmallTalk(l.body))?.body ?? null;
}

const LEAD = /^(?:please|pls|can you|could you|would you|will you|i need you to|i want you to|i would like you to|i'd like you to|i need|i want|help me|help|let's|lets|how do i|how do we|how can i|what is|what's|tell me|show me)\s+/i;

const OPENING_GREETING = /^\s*(?:h+e+y+|h+i+|h+e+l+o+|good (?:morning|afternoon|evening)|greetings)\b(?:\s+(?:there|all|team|everyone|assistant|vyre))?[\s,!.:;-]*/i;

/** A title from the words of the request alone: the plain fallback when no model is at hand. 2 to 5 words, no greeting, no ending punctuation. */
export function titleFromRequest(text: string): string | null {
  // a greeting in front of the real request ("Hello! Can you ...") is not what the chat is about
  let t = words((text.split("\n").find((l) => l.trim() !== "") ?? "").replace(OPENING_GREETING, "")).join(" ");
  for (let i = 0; i < 3 && LEAD.test(t); i++) t = t.replace(LEAD, "");
  const w = t.split(" ").filter((x) => x !== "").slice(0, 5);
  if (w.length < 2) return null;
  return tidyTitle(w.join(" "));
}

const DANGLING: ReadonlySet<string> = new Set(["a", "an", "the", "for", "to", "of", "with", "and", "or", "in", "on", "at", "by", "from", "that", "my", "our", "your", "their", "his", "her", "this", "these", "those", "about", "into", "as"]);

/** A model's answer made into a title: one line, quotes and endings off, 2 to 5 words, first letter up. Null when nothing usable is left. */
export function tidyTitle(raw: string): string | null {
  const line = raw.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
  const w = line.replace(/^(?:title\s*:\s*)/i, "").replace(/^["'`*#\s]+|["'`*.!?:;,\s]+$/g, "").split(/\s+/).filter((x) => x !== "").slice(0, 5);
  if (w.length < 2) return null;
  // a title cut at five words must not end on a word that wants another ("create a", "note for"): drop those, and when fewer than two words are left there is no title yet
  while (w.length > 0 && DANGLING.has(w[w.length - 1]!.toLowerCase())) w.pop();
  if (w.length < 2) return null;
  const s = w.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const TITLE_SYSTEM = "You name a chat. Reply with a title of 2 to 5 plain words that says what the person asked for, such as: GHL onboarding goal. No quotes, no ending punctuation, no greeting, nothing else.";
