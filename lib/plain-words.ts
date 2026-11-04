// Words an agent never says to a person (owner, 4 Nov 2026): the name of an internal tool or a capability ("task_submit", "use_tool"), or an id ("usr_...", "thr_..."). People and chats are named by their
// names. This finds them in a reply, so a test over replies can fail when one slips in.

const IDS = /\b(?:usr|agt|thr|tsk|prj|fil|rec|chn|msg|crw|trn|cmt)_[0-9a-f]{6,}\b/;
const TOOLS = /\b(?:use_tool|tool_search|load_skill|task_(?:submit|ask|block|decide|plan|assign)|crew_(?:start|list|merge|push|message|stop|wait)|message_person|people_status|[a-z]+_[a-z]+_(?:get|list|set|create|update|delete|search))\b/;

/** Bookkeeping a helper must not say as its answer: that it submitted the task. */
const HANDED_IN = /\b(?:the |this |my )?(?:task|work|result)s? (?:is |was |has been |are )?(?:submitted|handed in)\b|\bI(?:'ve| have)? (?:submitted|handed in)\b/i;

/** What in a reply a person should never read; empty when it is clean. */
export function internalNames(text: string): string[] {
  const out: string[] = [];
  for (const re of [IDS, TOOLS, HANDED_IN]) { const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`); for (const m of text.matchAll(g)) out.push(m[0]); }
  return [...new Set(out)];
}

/** What a helper is doing right now, in words a person reads: never the name of the tool. `detail` is what the call touches (a file, an address), already in safe words. */
export function stepWords(tool: string, detail?: string): string {
  const d = detail ? ` ${detail.length > 60 ? `${detail.slice(0, 59)}…` : detail}` : "";
  if (/^(Read|Glob|Grep|files_read|files_tree|files_list)/i.test(tool)) return `Reading${d || " files"}`;
  if (/^(Write|Edit|MultiEdit|NotebookEdit|files_create|files_write)/i.test(tool)) return `Editing${d || " a file"}`;
  if (/^(Bash|terminal_run)/i.test(tool)) return "Running a command";
  if (/^(WebSearch|web_search)/i.test(tool)) return "Searching the web";
  if (/^(WebFetch|read_link)/i.test(tool)) return `Reading${d || " a page"}`;
  if (/^(Agent|Task)$/.test(tool) || /^sub_task/.test(tool)) return "Working with a helper";
  return "Working";
}

/** One line of what a helper found: the first sentence of its last words, short. */
export function oneLine(text: string, max = 140): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t === "") return "";
  const first = t.split(/(?<=[.!?])\s/)[0] ?? t;
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}
