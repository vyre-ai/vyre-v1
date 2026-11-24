// Words written by someone else (a branch name, a site name) shown on a card: cut by whole graphemes first, then every character that hides itself or changes what is read is written out as \uXXXX (control, format, bidirectional, line and
// paragraph separators, joiners and fillers, variation selectors, tags), so what a person reads is what is there, an escape is never split and a cut never leaves half a character.
const HIDDEN =
  /^[\p{Cc}\p{Cf}\u2028\u2029\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u2800\u3164\uffa0\ufe00-\ufe0f\u{e0100}-\u{e01ef}]$/u;
const escape = (c: string): string => {
  const n = c.codePointAt(0)!;
  return n > 0xffff ? `\\u{${n.toString(16)}}` : `\\u${n.toString(16).padStart(4, "0")}`;
};
export function visibleText(text: string, max: number): string {
  const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const graphemes = Array.from(seg.segment(text), (s) => s.segment).slice(0, max);
  return graphemes
    .map((g) =>
      Array.from(g)
        .map((c) => (HIDDEN.test(c) ? escape(c) : c))
        .join(""),
    )
    .join("");
}
