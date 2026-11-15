// Names an outside item takes in Files. Shared by the mount engine and the outbound moves (which must never compare the provider's name with a display name).

/**
 * The name an outside item is shown under in Files, by one rule. The provider's name is the provider's: Files refuses a slash or backslash, control characters, "." and "..", an empty name and
 * more than 255 characters, and a person cannot rename a Drive item to dodge that. So a slash or backslash becomes "-", a control character becomes a space, the ends are trimmed, an empty or
 * dot-only name becomes "Untitled", and a name over 255 characters is cut in its stem (the extension stays). The provider's own name stays on the mount's item: it is what Open in Google Drive,
 * a write back and the next pass compare with.
 */
export function displayName(name: string): string {
  let n = name
    .replace(/[\\/]/g, "-")
    .replace(/[\u0000-\u001f]/g, " ")
    .trim();
  if (n === "" || n === "." || n === "..") return "Untitled";
  if (n.length > 255) {
    const dot = n.lastIndexOf(".");
    const ext = dot > 0 && n.length - dot <= 20 ? n.slice(dot) : "";
    n = `${n.slice(0, 255 - ext.length).trimEnd()}${ext}`;
  }
  return n;
}

/** Most names one item tries before the pass gives up on it: its own, then "(Google Drive)", "(Google Drive 2)" and on. A Drive holds hundreds of files called "Untitled document" or "Copy of ...", so the series is long: twenty stopped a Drive at its twenty-first double (F20). */
const NAME_TRIES = 1000;

/** The names an item may take in its Vyre folder, in order: its own, then the provider's name in brackets, numbered. "Plan.docx" becomes "Plan (Google Drive).docx". One at a time: a Drive of thousands of files builds only the few it needs. */
export function* nameSeries(name: string, label: string): Generator<string> {
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  yield name;
  for (let n = 1; n < NAME_TRIES; n++) yield `${stem} (${n === 1 ? label : `${label} ${n}`})${ext}`;
}

/** The same names as a list. */
export function freeNames(name: string, label: string): string[] {
  return [...nameSeries(name, label)];
}
