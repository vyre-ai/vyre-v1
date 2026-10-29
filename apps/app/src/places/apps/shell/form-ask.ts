// Ask Vyre on a form's source, in the editor: the pure parts. A proposal is a list of changed source fields; each is shown as a small line diff and accepted or rejected on its own.
export interface SourceChange { path: string; before: string; after: string }
export type DiffLine = { kind: "same" | "add" | "del"; text: string };
export const FIELD_TITLE: Readonly<Record<string, string>> = { "/html": "HTML", "/css": "CSS", "/js": "JavaScript" };

/** A line diff by trimming what the two share at both ends and showing the rest as removed then added: small, deterministic, and enough to read a change to a form's source. */
export function lineDiff(before: string, after: string, context = 2): DiffLine[] {
  if (before === after) return [];
  const a = before === "" ? [] : before.split("\n"), b = after === "" ? [] : after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  return [
    ...a.slice(Math.max(0, start - context), start).map((text): DiffLine => ({ kind: "same", text })),
    ...a.slice(start, endA).map((text): DiffLine => ({ kind: "del", text })),
    ...b.slice(start, endB).map((text): DiffLine => ({ kind: "add", text })),
    ...a.slice(endA, endA + context).map((text): DiffLine => ({ kind: "same", text })),
  ];
}

export const summaryOf = (c: SourceChange): string => {
  const lines = lineDiff(c.before, c.after, 0);
  const added = lines.filter((l) => l.kind === "add").length, removed = lines.filter((l) => l.kind === "del").length;
  return `${FIELD_TITLE[c.path] ?? c.path}: ${added} line${added === 1 ? "" : "s"} added, ${removed} removed`;
};

/** What an accepted change does to the editor's state: the whole new text of that field. */
export const applyChange = <T extends { html: string; css: string; js: string }>(state: T, c: SourceChange): T | null =>
  c.path === "/html" ? { ...state, html: c.after } : c.path === "/css" ? { ...state, css: c.after } : c.path === "/js" ? { ...state, js: c.after } : null;

/** All proposed changes as one readable block: each field's title, then its changed lines marked + and -. */
export const diffText = (changes: readonly SourceChange[], max = 40): string =>
  changes.map((c) => `${FIELD_TITLE[c.path] ?? c.path}\n${lineDiff(c.before, c.after).slice(0, max).map((l) => `${l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  "}${l.text}`).join("\n")}`).join("\n\n");
