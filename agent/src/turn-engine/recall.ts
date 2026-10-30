// What memory recalled for a message, as the words a model reads: one line per fact with the place it came from, and the exact words of past chat lines as quotes with their source ids,
// so the model can say where it knows a thing from and ask for the whole line by its id.
import type { RecallLine } from "./types.ts";

const day = (t: number): string => new Date(t).toISOString().slice(0, 10);

function lineOf(l: RecallLine): string {
  if (l.kind === "quote") {
    const who = l.by ? `${l.by}, ` : "";
    const when = l.at !== undefined ? `${day(l.at)}, ` : "";
    return `- Quote [${l.ref ?? "?"}] ${who}${when}in ${l.title}: "${l.fact ?? ""}"${l.cut ? " (cut: memory_quote with the ref gives the whole line)" : ""} (open: ${l.sourceLink ?? l.path})`;
  }
  const what = l.fact ? `${l.title}: ${l.fact}` : l.title;
  const since = l.trueSince !== undefined ? `, true since ${day(l.trueSince)}` : "";
  const id = l.ref ? `[${l.ref}] ` : "";
  return `- ${id}${what} (source: ${l.sourceLink ?? l.path}${since})`;
}

export function recallText(lines: readonly RecallLine[]): string {
  if (lines.length === 0) return "";
  return `From memory, for this message. Use it when it helps and say where it came from. Quotes are the exact words people wrote; quote them as written, and use memory_quote with a ref to read a whole line:\n${lines.map(lineOf).join("\n")}`;
}
