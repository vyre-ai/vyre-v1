// What memory may bring back, and when. Used by the server (what a turn is handed, what exact-word search returns) and by the chat (what a reply's memory line counts), so both agree.
//   recallable(text)   a line worth recalling: not a greeting or thanks, not a few words, not the preamble and transcript an imported session starts with, not a command.
//   asksForWords(text) the person asked to find what was said (or what an earlier chat held): only then do exact words come back as quotes.

/** The words an imported session's first message starts with (modules/import sessions.continue). */
export const IMPORTED_PREAMBLE = /^\s*Continue this imported session\b/i;

const SMALL_TALK = new Set([
  "hi", "hii", "hiya", "hey", "heya", "hello", "yo", "sup", "hola", "morning", "gm", "good morning", "good afternoon", "good evening", "thanks", "thank you", "thx", "ty", "cheers", "ok", "okay", "k", "kk",
  "yes", "yeah", "yep", "yup", "no", "nope", "sure", "cool", "nice", "great", "good", "fine", "test", "testing", "ping", "continue", "go on", "go", "next", "done", "bye", "goodbye", "lol", "hmm", "wow",
]);

const MIN_LETTERS = 12;
const MAX_CHARS = 2000;

/** Letters only, lower case, for comparing with the small-talk list ("Hi!" and "hi'" are "hi"). */
const bare = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

export function recallable(text: string): boolean {
  const t = text.trim();
  if (t === "" || t.startsWith("/")) return false;
  if (IMPORTED_PREAMBLE.test(t)) return false;
  if (t.length > MAX_CHARS) return false;            // a pasted document or transcript is not a thing someone said
  const b = bare(t);
  if (SMALL_TALK.has(b)) return false;
  return b.replace(/\s/g, "").length >= MIN_LETTERS;
}

const ASKS = [
  /\bwhat (did|was|were|have)\b[^.?!]{0,60}\b(say|said|tell|told|mention|mentioned|ask|asked|write|wrote|decide|decided|agree|agreed)\b/i,
  /\b(find|search|look (up|for|back)|dig up|pull up|show me)\b[^.?!]{0,60}\b(said|say|wrote|message|messages|chat|chats|conversation|thread|mentioned|discussed|talked)\b/i,
  /\b(did|do|have)\s+(i|we|you|he|she|they|\w+)\s+(ever\s+)?(say|said|mention|mentioned|tell|told|discuss|discussed|talk|talked)\b/i,
  /\b(earlier|previous(ly)?|last (time|week|month|session|chat)|before|yesterday|back when|remember when)\b[^.?!]{0,60}\b(said|say|wrote|told|mentioned|discussed|talked|chat|conversation|message)\b/i,
  /\b(quote|exact(ly)? (words?|what)|word for word|verbatim)\b/i,
  /\bwhere (did|was)\b[^.?!]{0,40}\b(say|said|mention|mentioned|discuss|discussed)\b/i,
];

export function asksForWords(text: string): boolean {
  return recallable(text) && ASKS.some((r) => r.test(text));
}
