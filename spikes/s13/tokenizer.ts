// BERT WordPiece (uncased) as all-MiniLM-L6-v2 uses it: lowercase, strip accents, split on whitespace and punctuation, longest-match-first pieces with the ## prefix, [CLS] .. [SEP].
// The vocabulary is read from the pinned tokenizer.json, so the ids are the model's own.
export interface Vocab { ids: ReadonlyMap<string, number>; unk: number; cls: number; sep: number; pad: number }

export function vocabOf(tokenizerJson: string): Vocab {
  const j = JSON.parse(tokenizerJson) as { model: { vocab: Record<string, number> } };
  const ids = new Map(Object.entries(j.model.vocab));
  const need = (t: string): number => { const v = ids.get(t); if (v === undefined) throw new Error(`the tokenizer has no ${t}`); return v; };
  return { ids, unk: need("[UNK]"), cls: need("[CLS]"), sep: need("[SEP]"), pad: need("[PAD]") };
}

const isPunct = (c: string): boolean => /[\p{P}\p{S}]/u.test(c) || (c >= "!" && c <= "/") || (c >= ":" && c <= "@") || (c >= "[" && c <= "`") || (c >= "{" && c <= "~");

/** Words as the model sees them: lowercased, accents removed, punctuation its own word. */
export function basicWords(text: string): string[] {
  const clean = text.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
  const words: string[] = [];
  let cur = "";
  for (const c of clean) {
    if (/\s/u.test(c)) { if (cur) { words.push(cur); cur = ""; } }
    else if (isPunct(c)) { if (cur) { words.push(cur); cur = ""; } words.push(c); }
    else cur += c;
  }
  if (cur) words.push(cur);
  return words;
}

const MAX_WORD = 100;

export function wordpiece(word: string, v: Vocab): number[] {
  const chars = [...word];
  if (chars.length > MAX_WORD) return [v.unk];
  const out: number[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = chars.length;
    let found: number | undefined;
    while (start < end) {
      const piece = (start > 0 ? "##" : "") + chars.slice(start, end).join("");
      const id = v.ids.get(piece);
      if (id !== undefined) { found = id; break; }
      end--;
    }
    if (found === undefined) return [v.unk];
    out.push(found);
    start = end;
  }
  return out;
}

/** [CLS] pieces [SEP], cut to `max` tokens (the last one stays [SEP]). */
export function encode(text: string, v: Vocab, max = 128): number[] {
  const body: number[] = [];
  for (const w of basicWords(text)) { body.push(...wordpiece(w, v)); if (body.length >= max - 2) break; }
  return [v.cls, ...body.slice(0, max - 2), v.sep];
}
