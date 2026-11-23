// Whole-word matching for the conditions of a SyncSpec (`onlyWhen.matches`, `eachOf.where.matches`): one shared function for the connectors module (validate) and the sync engine (every row).
// A condition is a list of words or phrases; no pattern from a spec is ever run. One pass over the first 200 characters of the value, so a hostile value cannot hold the loop.

/** The words of a text, lower case, letters and digits only; at most the first 200 characters are looked at. */
export const wordsOf = (s: string): string[] =>
  s
    .slice(0, 200)
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];

/** Does the text hold one of the words or phrases, as whole words (a phrase is words side by side)? Case does not matter. Linear in the text, whatever the words are. */
export function hasWords(text: string, phrases: readonly string[]): boolean {
  const t = wordsOf(text);
  return phrases.some((ph) => {
    const p = wordsOf(ph);
    if (!p.length) return false;
    for (let i = 0; i + p.length <= t.length; i++) {
      let all = true;
      for (let j = 0; j < p.length; j++)
        if (t[i + j] !== p[j]) {
          all = false;
          break;
        }
      if (all) return true;
    }
    return false;
  });
}
