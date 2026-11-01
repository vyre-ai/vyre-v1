// What a turn is doing, in a few words: from the host's step names and the provider's thinking, never invented. Pure, so the same words come out wherever a reply streams.
import type { ActivitySnapshot } from "../../../shell/session/turn-streams.ts";

/** A tool's name as a person would say what is happening: "Read" is "Reading", a Vyre tool "mcp__vyre__records_search" is "Searching records". Unknown names stay plain. */
export function stepWords(name: string): string {
  const n = name.replace(/^mcp__[a-z0-9]+__/i, "").replace(/^vyre[_-]/i, "");
  const key = n.toLowerCase();
  const table: Record<string, string> = {
    read: "Reading", glob: "Looking for files", grep: "Searching", bash: "Running a command", edit: "Editing", multiedit: "Editing", write: "Writing a file", notebookedit: "Editing a notebook",
    websearch: "Searching the web", webfetch: "Reading a page", task: "Working with a helper", todowrite: "Planning", exitplanmode: "Planning", askuserquestion: "Asking you",
  };
  if (table[key]) return table[key]!;
  const words = key.split(/[_\s-]+/).filter(Boolean);
  if (words.length === 0) return "Working";
  const verb: Record<string, string> = { search: "Searching", list: "Looking through", get: "Reading", read: "Reading", create: "Creating", update: "Updating", delete: "Removing", send: "Sending", run: "Running", draft: "Drafting" };
  const first = words[0]!;
  if (verb[first]) return `${verb[first]} ${words.slice(1).join(" ")}`.trim();
  const last = words[words.length - 1]!;
  if (verb[last]) return `${verb[last]} ${words.slice(0, -1).join(" ")}`.trim();
  return `Using ${words.join(" ")}`;
}

/** The last stretch of thinking as one short line, or "". */
export function thinkingExcerpt(text: string, max = 72): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one === "") return "";
  return one.length > max ? `…${one.slice(one.length - max).trimStart()}` : one;
}

export interface ActivityLine { label: string; detail: string }

/** The one line: a step in progress wins, then what is being thought, else "Thinking". `elapsed` seconds are added by the caller once they matter. */
export function activityLine(s: ActivitySnapshot): ActivityLine {
  const live = [...s.steps].reverse().find((x) => x.state === "live");
  if (live) return { label: live.name !== "" ? stepWords(live.name) : "Working", detail: "" };
  const t = thinkingExcerpt(s.thinking);
  return { label: "Thinking", detail: t };
}

export const elapsedWords = (secs: number): string => (secs < 3 ? "" : secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`);
