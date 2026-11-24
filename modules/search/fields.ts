// The words of a record's fields, as the index keeps them and as a search shows them to a person who may see only some of the fields (handlers/index.ts, handlers/query.ts).
import { isRawId } from "../../lib/id-shapes.ts";

export const SECRET = /pass(word|phrase)?|secret|token|api.?key|credential/i;

/** The words of a record's fields: strings, numbers and lists of strings; nothing that looks like a credential, and no id (a field that holds a person, a folder or another record holds its id, which is no word of the record and is shown to a person as its snippet). */
export function fieldWords(fields: Record<string, unknown>, skip: string): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === skip || SECRET.test(k)) continue;
    if (typeof v === "string") {
      if (!isRawId(v)) out.push(v);
    } else if (typeof v === "number") out.push(String(v));
    else if (Array.isArray(v)) for (const x of v) if (typeof x === "string" && !isRawId(x)) out.push(x);
  }
  return out.join(" ");
}
