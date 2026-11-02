// Questions about Vyre itself: the words that load the about-vyre skill into a turn, and the read tools a CLI engine needs listed to check this Space before it answers.
// Tested against what people type (lib/tests/about-vyre.test.ts). A miss only means the agent loads the skill from its index; a false hit only adds the skill's text to that one turn.

export const ABOUT_VYRE_SKILL = "about-vyre";

const PARTS: readonly string[] = [
  // names Vyre and asks something about it
  String.raw`\b(what|how|why|can|could|does|do|did|is|are|will|would|should|where|which)\b[^.!\n]{0,80}\bvyre\b`,
  String.raw`\bvyre\b[^.!\n]{0,100}\?`,
  // asks for an opinion of the product it is in
  String.raw`\b(what do you think|your (take|view|opinion)|thoughts)\b[^.!\n]{0,30}\b(vyre|this app|this product|this tool|this workspace)\b`,
  // replacing or comparing it with another tool
  String.raw`\b(replace|replacement|replacing|instead of|switch(ing)? from|move from|moving from|compared? (to|with)|comparison|versus|vs\.?|alternative to|better than)\b[^.!\n]{0,60}\b(claude( code| cli)?|codex|cursor|copilot|windsurf|aider|grok|gemini( cli)?|chatgpt|cli|ide|jira|linear|asana|notion|trello|clickup|monday)\b`,
  // which engines and providers it supports
  String.raw`\b(support|supports|supported|work with|works with|run on|runs on)\b[^.!\n]{0,40}\b(codex|claude code|grok|openrouter|opencode|ollama|lm studio|gemini|openai|anthropic|xai|local models?)\b`,
  String.raw`\b(does|can|will) (it|this|this app|vyre)\b[^.!\n]{0,40}\b(codex|claude code|grok|openrouter|opencode|ollama|gemini|repo|repository|github|pull requests?|prs?|branch(es)?|ci|crash(es)?|restarts?|context limits?)\b`,
  // how to do something here, in the product
  String.raw`\bhow (do|can|would|should) (i|we)\b[^.!\n]{0,80}\b(here|in vyre|in this app|in this space)\b`,
];

/** The words that make a message a question about Vyre itself. */
export const ABOUT_VYRE_INTENT = new RegExp(PARTS.join("|"), "i");

/** Read tools a chat lists from the start so an engine can check this Space before it says what Vyre can do here: a CLI engine cannot pick up a tool found later with tool_search. */
export const ABOUT_VYRE_TOOLS: readonly string[] = ["engine_providers_list", "engine_accounts_list", "spaces_matrix"];
