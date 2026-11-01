// The memory guide an agent's engine reads (memory design, "Native for any model"): the same text goes to CLAUDE.md (Claude Code) and AGENTS.md (Codex, OpenCode and the rest) in the agent's
// folder and in a CLI session's work folder, so an engine that never sees Vyre's system prompt still knows it has memory, which tools reach it, and what its map says. The map is the agent's
// MAP.md as the nightly job last wrote it; this file is rewritten from it, never edited by hand.

/** The two file names, written with the same body. */
export const GUIDE_FILES = ["CLAUDE.md", "AGENTS.md"] as const;

/** First line of every guide, so a reader (and the sync) can tell a Vyre guide from a file somebody wrote. */
export const GUIDE_MARK = "<!-- Written by Vyre memory from MAP.md. Edit MAP.md or the agent's notes, not this file. -->";

const TOOLS = [
  "memory_search: look up notes and facts you may read",
  "memory_quote: the exact words of an earlier chat message or run step, with who said it, when and a link; pass q to look for words or ref to read one line in full",
  "memory_remember: save a fact with where it came from",
  "memory_forget: close a fact that is wrong or no longer true",
];

export function memoryGuide(agentName: string, mapBody: string | null | undefined): string {
  const map = (mapBody ?? "").trim();
  return [
    GUIDE_MARK,
    `# ${agentName}: memory`,
    "",
    "You remember through Vyre memory, over the `vyre` MCP server. Use these tools; do not keep your own notes.",
    "",
    ...TOOLS.map((t) => `- ${t}`),
    "",
    "Name a record, file, task or chat as [[Name|id]], the name, a bar and its id, like [[Rivera Holdings|rec_01...]]. Never write a bare id (rec_..., file_..., task_...) in a reply: the reader sees the name as a link that opens it.",
    "",
    "Facts recalled for a message come with their source. Quotes are the exact words people wrote: quote them as written, never reword them, and say where they came from. Memory you cannot see is not yours to guess.",
    "",
    map === "" ? "Your map is empty until the first night's upkeep has run." : map,
    "",
  ].join("\n");
}

/** Does this text start with the Vyre mark? A guide file that does not is somebody's own and is left alone. */
export const isGuide = (text: string): boolean => text.trimStart().startsWith(GUIDE_MARK);
