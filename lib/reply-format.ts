// What a reply can show, as the short guide every agent turn carries (in the stable "rules" part of the context, so it rides in the cached prefix and costs the tokens once). It says what the chat draws and when each
// form fits, in the order a model decides: the information first, then the most useful way to show it. The longer examples live in the working-in-vyre skill. Keep it under REPLY_FORMAT_MAX_TOKENS (tested).

export const REPLY_FORMAT = [
  "Reply in Markdown, which the chat draws. Answer first, then show it the most useful way. One visual per point; never a table for one row or a diagram for two steps.",
  "- Comparing things on two or more attributes: a table (| a | b | then a |---|---| row).",
  "- A process, flow or timeline with steps or branches: a ```mermaid block (flowchart, sequenceDiagram, stateDiagram-v2, gantt, erDiagram, mindmap, pie).",
  "- Numbers by time or category: a ```chart block holding one JSON object {\"type\":\"bar|line|area|pie|scatter\",\"labels\":[...],\"series\":[{\"name\":\"..\",\"data\":[...]}]}.",
  "- Math: $x^2$ inline, $$ ... $$ for a display formula. Code: a fence with its language.",
  "- > [!NOTE], > [!TIP] or > [!WARNING] for a callout. A long reply: collapsible parts, each > [!section] Title with the body on following > lines ([!section+] starts open), or <details><summary>T</summary>...</details>. - [ ] item for a checklist people can tick. [^1] and [^1]: text for a source. ![alt](https://...) for an image.",
  "- Emphasis, sparingly: **bold** *italic* ++underline++ ~~strike~~ and ==highlight== for the one thing to see.",
  "- Short options to pick in one press (sent as their reply): a ```choices block, one per line.",
  "- A decision the person must make: ask_question. A plan: plan_propose. A key: vault_request. A document or app to keep: artifact_publish.",
  "- To point at something write [[Name|id]], the id exactly as a tool gave it: a Vyre task, record, file, note, chat or person; an email thread or calendar event from its tool. With no tool id, write the name alone. Never type an address, a bare id or a ref.vyre.invalid link.",
  "- No other HTML than <br> <kbd> <sub> <sup> <mark> <u>. If a diagram or chart might not draw, say the point in words too.",
].join("\n");

/** A rough count of tokens for English and code: a token is about 3.6 characters. */
export const estimateTokens = (s: string): number => Math.ceil(s.length / 3.6);

export const REPLY_FORMAT_MAX_TOKENS = 480;
