// from vyre 0.6.9 lib/tokens.js@dbd2dfbab
// The one token estimator for sizes that are budgets and not bills: a model's tokens are about a quarter of the characters of English and code.

/** Characters to a token: the one number every rough count uses. */
export const CHARS_PER_TOKEN = 4;

export const tokens = (text: string): number => Math.ceil(String(text).length / CHARS_PER_TOKEN);

/** The same count for a length already known. */
export const tokensOfChars = (chars: number): number => Math.ceil(Math.max(0, Number(chars) || 0) / CHARS_PER_TOKEN);
