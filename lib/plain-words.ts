// Words an agent never says to a person (owner, 4 Nov 2026): the name of an internal tool or a capability ("task_submit", "use_tool"), or an id ("usr_...", "thr_..."). People and chats are named by their
// names. This finds them in a reply, so a test over replies can fail when one slips in.

const IDS = /\b(?:usr|agt|thr|tsk|prj|fil|rec|chn|msg|crw|trn|cmt)_[0-9a-f]{6,}\b/;
const TOOLS = /\b(?:use_tool|tool_search|load_skill|task_(?:submit|ask|block|decide|plan|assign)|crew_(?:start|list|merge|push|message|stop|wait)|message_person|people_status|[a-z]+_[a-z]+_(?:get|list|set|create|update|delete|search))\b/;

/** What in a reply a person should never read; empty when it is clean. */
export function internalNames(text: string): string[] {
  const out: string[] = [];
  for (const re of [IDS, TOOLS]) { const g = new RegExp(re.source, "g"); for (const m of text.matchAll(g)) out.push(m[0]); }
  return [...new Set(out)];
}
