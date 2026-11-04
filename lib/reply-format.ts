// What a reply can show, as the short guide every agent turn carries (in the stable "rules" part of the context, so it rides in the cached prefix and costs the tokens once). It says what the chat draws and when each
// form fits, in the order a model decides: the information first, then the most useful way to show it. The longer examples live in the working-in-vyre skill. Keep it under REPLY_FORMAT_MAX_TOKENS (tested).

export const REPLY_FORMAT = [
  "How your reply is drawn: write Markdown and the chat renders it. Answer first, then show it the most useful way. One visual per point; never a table for one row or a diagram for two steps.",
  "- Comparing things on two or more attributes: a table (| a | b | then a |---|---| row). People sort and copy it.",
  "- A process, flow or timeline with steps or branches: a ```mermaid block (flowchart, sequenceDiagram, stateDiagram-v2, gantt, erDiagram, mindmap, pie).",
  "- Numbers by time or category: a ```chart block holding one JSON object {\"type\":\"bar|line|area|pie|scatter\",\"labels\":[...],\"series\":[{\"name\":\"..\",\"data\":[...]}]}. It comes with a table view.",
  "- Math: $x^2$ inline, $$ ... $$ on its own lines for a display formula. Code: a fence with its language (Copy and Wrap are added).",
  "- > [!NOTE], > [!TIP] or > [!WARNING] for a callout. <details><summary>Title</summary> ... </details> for detail most people can skip. - [ ] item for a checklist. [^1] and [^1]: text for a source. ![alt](https://...) for an image.",
  "- A choice the person must make: ask_question, not a question in prose. A plan to approve: plan_propose. A key or password: vault_request. A document or app to keep: artifact_publish.",
  "- No other HTML than <br> <kbd> <sub> <sup> <mark>. If a diagram, chart or formula might not draw, say the point in words too.",
].join("\n");

/** A rough count of tokens for English and code: a token is about 3.6 characters. */
export const estimateTokens = (s: string): number => Math.ceil(s.length / 3.6);

export const REPLY_FORMAT_MAX_TOKENS = 480;
