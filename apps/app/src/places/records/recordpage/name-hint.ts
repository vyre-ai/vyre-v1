// The name of a record a list row was tapped on, kept for the page that opens: the page paints that name in its first frame, where it used to say "Record" until the record had loaded.
const names = new Map<string, string>();

export function rememberRecordName(id: string, name: string): void {
  if (name.trim() === "") return;
  if (names.size > 200) names.delete(names.keys().next().value as string);
  names.set(id, name);
}

/** The name remembered for a record, or an empty text. */
export const recordNameHint = (id: string): string => names.get(id) ?? "";
