// from vyre 0.6.9 lib/seed.js@dbd2dfbab
// The block put in front of a first message when a conversation is rolled over or handed to another engine. Anything that reads the person's words
// (search, titles, pointers) reads only those: this is the one place that says where the seed ends.

/** The seed opens with this. */
export const SEED_OPEN = "[Vyre continuation:";
/** It ends at the first closing bracket on a line of its own, then a blank line, then the person's words. */
const SEED_END = /\n\]\n\n/;

/** A message's own words, without any Vyre block carried in front of it (a seed, or a note of what happened while an engine was away). */
export function withoutVyre(text: string): string {
  let t = String(text);
  for (let n = 0; n < 4 && /^\[Vyre[ :]/.test(t); n++) {
    const m = SEED_END.exec(t);
    if (!m) return "";
    t = t.slice(m.index + m[0].length);
  }
  return t;
}

/** A message's own words, without a seed. A message that is only a seed has no words of its own: "". */
export function withoutSeed(text: string): string {
  const t = String(text);
  if (!t.startsWith(SEED_OPEN)) return t;
  const m = SEED_END.exec(t);
  return m ? t.slice(m.index + m[0].length) : "";
}
