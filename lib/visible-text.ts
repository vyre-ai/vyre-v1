// Words written by someone else (a branch name, a file name) shown on a card: cut by whole characters first, then control and bidirectional characters are written out as \uXXXX, so what a person reads is what is there and an escape is never split.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/;
export function visibleText(text: string, max: number): string {
  return Array.from(text)
    .slice(0, max)
    .map((c) => (HIDDEN.test(c) ? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}` : c))
    .join("");
}
