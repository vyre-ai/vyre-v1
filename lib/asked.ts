// "Asked this turn" (chat design, hole 3): what a person's own message asks to go out. It reads only the words the person typed, never anything a model wrote, and it is plain matching, so the same
// message always gives the same answer. Each row becomes a single-use grant the Gate matches. A miss is safe: the act waits for a yes. Quoted lines and code are skipped, because a pasted email is not the
// person asking. A verb counts only as a request: at the head of a clause or after words that ask ("please", "can you", "and").

export interface Asked { act: string; /** an address, repo, host, channel or name; "" when the message names none */ target: string }

const LEAD = String.raw`(?:^|\b(?:please|pls|kindly|then|and|also|now|ok|okay|yes|yep|sure|just|go ahead and|can you|could you|would you|will you|you can|you may|i need you to|i want you to|i'd like you to|make sure to|be sure to|remember to|let'?s|lets)\s+)`;
const NEVER = /\b(don'?t|do not|never|not|no need to|without|stop|cancel|avoid|won'?t|shouldn'?t|wouldn'?t)\b/i;

const VERBS: ReadonlyArray<readonly [RegExp, readonly string[], "named"?]> = [
  [new RegExp(`${LEAD}(send)\\b[^.]*\\b(signature|e-?sign)\\b`, "i"), ["signature_send"]],
  [new RegExp(`${LEAD}(send|email|e-mail|mail|text|sms|message|dm|reply|respond|forward|share|call|invite|schedule|book)\\b`, "i"), ["send"]],
  // a teammate reached in Vyre for the person (lane l-agentdm): "tell Andrey the deck is ready", "ask Rubab for the key", "let Sam know", "remind Lee", "ping Mia". These count only with a name:
  // "tell me", "let me know" and "ask around" are not a request to send anything, and a request that names nobody would cover any target.
  [new RegExp(`${LEAD}(tell|ask|remind|ping|nudge|notify|let)\\b`, "i"), ["send"], "named"],
  // a calendar entry for the person ("put it on the calendar", "add an event", "book a meeting with Sam"): it invites people, so it is a send
  [new RegExp(`${LEAD}(put|add|create|schedule|book|set up)\\b[^.]*\\b(calendar|event|meeting|invite)\\b`, "i"), ["send"]],
  [new RegExp(`${LEAD}(post|tweet|comment|upload)\\b`, "i"), ["post"]],
  [new RegExp(`${LEAD}(publish)\\b`, "i"), ["post", "site_promote"]],
  [new RegExp(`${LEAD}(?:open|create|file|raise|make)\\s+(?:a|an|the)\\s+(?:new\\s+)?(pull request|pr|issue)\\b`, "i"), ["post"]],
  [new RegExp(`${LEAD}(push)\\b`, "i"), ["push_protected"]],
  [new RegExp(`${LEAD}(deploy|promote|ship|go live)\\b`, "i"), ["site_promote"]],
  [new RegExp(`${LEAD}(ssh|curl)\\b`, "i"), ["send"]],
];

const NOT_A_NAME = new Set(["the", "a", "an", "it", "this", "that", "these", "those", "them", "him", "her", "me", "us", "my", "our", "your", "their", "his", "all", "everyone", "everybody", "out", "back", "up", "over", "off", "to", "and", "with", "about", "for", "on", "in", "at", "from", "of", "again", "now", "today", "tomorrow", "soon", "new", "some", "any", "each", "every"]);

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL_RE = /https?:\/\/[^\s)>\]]+/g;
const PHONE = /\+\d[\d\s().-]{6,}\d/g;
const REPO = /(?<![\w./@-])[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*\b/g;
const CHANNEL = /(?<![\w&])#[A-Za-z][\w-]*/g;
const MENTION = /(?<![\w.+-])@([A-Za-z][\w.-]*)/g;

/** The message without what the person did not write themselves: fenced code, inline code, quoted lines. */
function ownWords(body: string): string {
  return body.replace(/```[\s\S]*?(```|$)/g, " ").replace(/`[^`\n]*`/g, " ").split("\n").filter((l) => !/^\s*>/.test(l)).join("\n");
}
const clauses = (text: string): string[] => text.split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter((s) => s !== "");

function namesIn(rest: string, loose: boolean): string[] {
  const out: string[] = [];
  const to = /\b(?:to|with)\s+([A-Z][\w'-]+)/g;
  for (const m of rest.matchAll(to)) out.push(m[1]!.toLowerCase());
  const first = /^\s*([A-Za-z][\w'-]*)/.exec(rest)?.[1];
  if (loose && first !== undefined && !NOT_A_NAME.has(first.toLowerCase())) out.push(first.toLowerCase());
  return out;
}

/** What a clause names after its verb. A push names its branch or remote with a plain "to main"; a send names a person directly after the verb ("email Sarah"). */
function targetsIn(rest: string, act: string): string[] {
  const out = new Set<string>();
  let text = rest;
  for (const m of text.matchAll(URL_RE)) { try { out.add(new URL(m[0]).hostname.toLowerCase()); } catch { /* not an address */ } }
  text = text.replace(URL_RE, " ");
  for (const m of text.matchAll(EMAIL)) out.add(m[0].toLowerCase());
  text = text.replace(EMAIL, " ");
  for (const m of text.matchAll(PHONE)) out.add(m[0].replace(/[\s().-]/g, ""));
  for (const m of text.matchAll(REPO)) out.add(m[0].toLowerCase());
  for (const m of text.matchAll(CHANNEL)) out.add(m[0].toLowerCase());
  for (const m of text.matchAll(MENTION)) out.add(m[1]!.toLowerCase());
  if (act === "push_protected") { for (const m of text.matchAll(/\bto\s+(?:the\s+)?([\w./-]+)/gi)) if (!NOT_A_NAME.has(m[1]!.toLowerCase())) out.add(m[1]!.toLowerCase()); }
  else if (out.size === 0) for (const n of namesIn(text, act === "send")) out.add(n);
  return [...out];
}

interface Hit { at: number; end: number; acts: readonly string[]; named: boolean }
/** Every verb of a clause that is a request. What follows a verb up to the next one is its own: "email lee, then push to main" gives main to the push alone. */
function hitsIn(clause: string): Hit[] {
  const hits: Hit[] = [];
  for (const [verb, acts, named] of VERBS) {
    for (const m of clause.matchAll(new RegExp(verb.source, "gi"))) {
      const at = m.index + m[0].lastIndexOf(m[1]!);
      if (!NEVER.test(clause.slice(0, at))) hits.push({ at, end: at + m[1]!.length, acts, named: named === "named" });
    }
  }
  return hits.sort((a, b) => a.at - b.at);
}

/** Each act this message asks for, once per target. Empty when it asks for nothing outward. */
export function askedIn(body: string): Asked[] {
  const seen = new Map<string, Asked>();
  for (const clause of clauses(ownWords(body))) {
    const hits = hitsIn(clause);
    for (const h of hits) {
      const next = hits.find((o) => o.at >= h.end);
      const rest = clause.slice(h.end, next?.at ?? clause.length);
      for (const act of h.acts) {
        const targets = targetsIn(rest, act);
        if (h.named && targets.length === 0) continue;
        for (const target of targets.length > 0 ? targets : [""]) seen.set(`${act}\n${target}`, { act, target });
      }
    }
  }
  return [...seen.values()];
}

const GO = /^\s*(?:@[\w.-]+\s+)?(?:yes|yep|yeah|yup|sure|ok|okay|go ahead|do it|please do|sounds good|approved?|send it|confirmed?|go for it)\b/i;
/** A clear go-ahead to what was just proposed: it opens with yes, ok, go ahead, do it, and is not a question, a refusal or a long message about something else. */
export function isGoAhead(body: string): boolean {
  const own = ownWords(body).trim();
  return own.length > 0 && own.length <= 240 && GO.test(own) && !NEVER.test(own) && !/\?\s*$/.test(own);
}

/**
 * What an agent's last message said it would do, for a person's plain yes to answer. It is read only to find which kind of act the person was shown: a send or a post, once, with no target, so a yes opens
 * that one act and nothing wider (never a push, a deploy, a signature or money, and never more than one grant of a kind). The person's yes is the authority; these words only say what it was a yes to.
 */
export function proposedIn(agentBody: string): Asked[] {
  const said = ownWords(agentBody).replace(/\b(?:shall i|should i|want me to|would you like me to|do you want me to|i(?:'ll| will| can| could| am going to)|i'm going to|let me)\b/gi, "please");
  const acts = new Set(askedIn(said).map((a) => a.act).filter((a) => a === "send" || a === "post"));
  return [...acts].map((act) => ({ act, target: "" }));
}
