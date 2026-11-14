// What a turn is doing, in a few words: from the host's step names and the provider's thinking, never invented. Pure, so the same words come out wherever a reply streams.
import type { ActivitySnapshot } from "../../../shell/session/turn-streams.ts";

/** The tools the app knows by name, and what each is doing in words. */
const TOOL_WORDS: Record<string, string> = {
  read: "Reading",
  glob: "Looking for files",
  grep: "Searching",
  bash: "Running a command",
  edit: "Editing",
  multiedit: "Editing",
  write: "Writing a file",
  notebookedit: "Editing a notebook",
  websearch: "Searching the web",
  toolsearch: "Looking for tools",
  webfetch: "Reading a page",
  terminal_run: "Running a command",
  read_link: "Reading a page",
  web_search: "Searching the web",
  task: "Working with a helper",
  agent: "Working with a helper",
  sub_task_model: "Starting a helper",
  crew_start: "Starting a teammate",
  crew_merge: "Asking to merge",
  crew_push: "Asking to push",
  todowrite: "Planning",
  exitplanmode: "Planning",
  askuserquestion: "Asking you",
};

/** A tool's name as a person would say what is happening: "Read" is "Reading", a Vyre tool "mcp__vyre__records_search" is "Searching records". Unknown names stay plain. */
export function stepWords(name: string): string {
  const n = name.replace(/^mcp__[a-z0-9]+__/i, "").replace(/^vyre[_-]/i, "");
  const key = n.toLowerCase();
  const table = TOOL_WORDS;

  if (table[key]) return table[key]!;
  const words = n
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean);
  if (words.length === 0) return "Working";
  const verb: Record<string, string> = {
    search: "Searching",
    list: "Looking through",
    get: "Reading",
    read: "Reading",
    create: "Creating",
    update: "Updating",
    delete: "Removing",
    send: "Sending",
    run: "Running",
    draft: "Drafting",
  };
  const first = words[0]!;
  if (verb[first]) return `${verb[first]} ${words.slice(1).join(" ")}`.trim();
  const last = words[words.length - 1]!;
  if (verb[last]) return `${verb[last]} ${words.slice(0, -1).join(" ")}`.trim();
  return `Using ${words.join(" ")}`;
}

/** The last stretch of thinking as one short line, or "". */
export function thinkingExcerpt(text: string, max = 72): string {
  // a tool's own name never shows (owner, 4 Nov): a snake_case or mcp__ name in the thinking is said as what it does ("I'll call terminal_run" reads "I'll call running a command")
  // only a known tool's name (or a server's mcp__ name) is replaced: an ordinary word with an underscore ("user_id") is left as written
  const one = text
    .replace(/\bmcp__[a-z0-9]+__[A-Za-z0-9_]+|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, (m) =>
      m.startsWith("mcp__") || TOOL_WORDS[m.toLowerCase()] ? stepWords(m).toLowerCase() : m,
    )
    .replace(/\s+/g, " ")
    .trim();
  if (one === "") return "";
  return one.length > max ? `…${one.slice(one.length - max).trimStart()}` : one;
}

/** A step in words, with what it touches when the host said so: "Reading model.ts", "Searching the web: stream pacing". A turn waiting while Vyre installs its engine reads "Setting up Codex". */
export function stepLabel(name: string, detail?: string): string {
  if (name === "engine_setup") return detail ? `Setting up ${detail}` : "Setting up";
  // the Windows sandbox starting (or set up once) reads as the engine says it: "Starting the Windows sandbox, first turn after a restart"
  if (name === "sandbox_start") return detail || "Starting the Windows sandbox";
  // a turn whose computer went to sleep, pinned to it: it waits for it (modules/engine/device-turns.ts)
  if (name === "device_wait") return "Waiting for your computer";
  const words = name !== "" ? stepWords(name) : "Working";
  if (!detail) return words;
  return /^(Read|Edit|MultiEdit|Write|NotebookEdit)$/.test(name) ? `${words} ${detail}` : `${words}: ${detail}`;
}

export interface ActivityLine {
  label: string;
  detail: string;
}

/** The one line: a step in progress wins, then what is being thought, else "Thinking". `elapsed` seconds are added by the caller once they matter. */
export function activityLine(s: ActivitySnapshot): ActivityLine {
  const running = s.steps.filter((x) => x.state === "live");
  // several tools running together (a step that asked for independent reads): one line that says how many, the calls named beside it
  if (running.length >= 2) {
    const reads = running.every((x) =>
      /(^|_)(list|get|search|read|query|find|history|count|counts|snapshot|status|view)(_|$)|^(read|glob|grep|websearch|webfetch|toolsearch)$/i.test(
        x.name.replace(/^mcp__[a-z0-9]+__/i, ""),
      ),
    );
    return {
      label: `${reads ? "Reading" : "Working on"} ${running.length} things`,
      detail: running.map((x) => stepLabel(x.name, x.detail)).join(" · "),
    };
  }
  const live = running[running.length - 1];
  if (live) return { label: stepLabel(live.name, live.detail), detail: "" };
  const t = thinkingExcerpt(s.thinking);
  return { label: "Thinking", detail: t };
}

export const elapsedWords = (secs: number): string =>
  secs < 3 ? "" : secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;

/** The one calm word a live reply shows (the prototype's islb): Writing once words are coming, Working while a step runs, else Thinking. Never a step's name, never a count. */
export function calmWord(s: ActivitySnapshot, writing: boolean): "Thinking" | "Writing" | "Working" {
  if (writing) return "Writing";
  return s.steps.some((x) => x.state === "live") ? "Working" : "Thinking";
}
