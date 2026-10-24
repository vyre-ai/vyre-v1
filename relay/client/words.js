// 2048 seed words. Each index 0..2047 maps to one 4-letter word.

const CONS = "bdfghjklmnprstvz";
const VOWS = "aeiou";

function wordAt(i) {
  let n = i;
  const c1 = CONS[n & 15];
  n >>= 4;
  const v1 = VOWS[n % 5];
  n = Math.floor(n / 5);
  const c2 = CONS[n & 15];
  n >>= 4;
  const v2 = VOWS[n % 5];
  return c1 + v1 + c2 + v2;
}

export const WORDS = [];
for (let i = 0; i < 2048; i++) WORDS.push(wordAt(i));

const index = new Map(WORDS.map((word, i) => [word, i]));
if (index.size !== 2048) throw new Error("seed wordlist collided");

export function wordIndex(word) {
  const found = index.get(word);
  return found === undefined ? -1 : found;
}
