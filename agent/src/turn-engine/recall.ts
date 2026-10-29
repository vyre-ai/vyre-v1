// What memory recalled for a message, as the words a model reads: one line per fact with the place it came from, so the model can say where it knows a thing from.
import type { RecallLine } from "./types.ts";

const day = (t: number): string => new Date(t).toISOString().slice(0, 10);

export function recallText(lines: readonly RecallLine[]): string {
  if (lines.length === 0) return "";
  const rows = lines.map((l) => {
    const what = l.fact ? `${l.title}: ${l.fact}` : l.title;
    const since = l.trueSince !== undefined ? `, true since ${day(l.trueSince)}` : "";
    return `- ${what} (source: ${l.sourceLink ?? l.path}${since})`;
  });
  return `From memory, for this message. Use it when it helps and say where it came from:\n${rows.join("\n")}`;
}
