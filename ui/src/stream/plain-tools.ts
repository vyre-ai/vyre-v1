// A tool is named to the model as mcp__<server>__<tool>. A person never reads that (owner, 14 Nov 2026): it reads "terminal run". The same rule as lib/plain-words.ts plainToolWords, kept here
// so the stream draws the plain words as they arrive, with a filter that holds back a tail that may still become such a name (a name can be split across deltas).
const NAME = /\bmcp__[a-z0-9_-]+?__([a-z0-9_]+)\b/gi;
const TAIL = /(?:^|[^\w])(?:m|mc|mcp|mcp_|mcp__[\w-]*)$/;

export const plainTools = (text: string): string =>
  text.replace(NAME, (_m, tool: string) => tool.replace(/_+/g, " ").trim());

/** Takes deltas, gives back what is safe to draw now. `flush()` gives back what was held at the end of the stream. */
export function createToolFilter(): { push(delta: string): string; flush(): string } {
  let held = "";
  return {
    push(delta) {
      const all = held + delta;
      const m = TAIL.exec(all);
      const cut = m ? all.length - (m[0].length - (/^\w/.test(m[0]) ? 0 : 1)) : all.length;
      held = all.slice(cut);
      return plainTools(all.slice(0, cut));
    },
    flush() {
      const out = plainTools(held);
      held = "";
      return out;
    },
  };
}
