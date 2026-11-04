// What a run's step is called to a person: the title its author gave it, else what its kind does ("Send an email", "Wait 2 days"), else its place in the flow ("Step 3"). Never the stored id, which is a code ("step_3",
// "n_7f3a") and never reads as words. The step kinds' own titles come from the registry; the caller hands the one for this step's kind in, so this stays free of generated files.
import { sayWords } from "./audit.ts";

export interface StepNode { id: string; key?: string | undefined; title?: string | undefined; input?: Record<string, unknown> | undefined }

/** An id a flow editor made: step_1, n_7f3a, node-12. Not a name anyone chose. */
export const idLike = (s: string): boolean => /^(?:step|node|n|s)[_-]?[0-9a-f]{1,10}$/i.test(s) || /^[a-z]{1,4}_(?=[0-9a-z]*\d)[0-9a-z]{4,}$/i.test(s) || /^[0-9a-f]{8,}$/i.test(s);

/** "30m" as "30 minutes", "6h" as "6 hours", "2d" as "2 days", "1w" as "a week". Null for anything else. */
export function durationWords(d: unknown): string | null {
  if (typeof d !== "string") return null;
  const m = /^(\d+)\s*(s|m|h|d|w)$/i.exec(d.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { s: "second", m: "minute", h: "hour", d: "day", w: "week" }[(m[2] as string).toLowerCase()] as string;
  return n === 1 && unit === "week" ? "a week" : `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** What each step kind does, in words a person uses (the registry's own titles are for the editor's palette and read like "HTTP request"). */
const KIND_WORDS: Readonly<Record<string, string>> = {
  ai: "Ask the AI", approval: "Ask for approval", call_automation: "Run another automation", code: "Run a small script", collect: "Collect the answers", connector_request: "Ask a connected service",
  create_task: "Create a task", group_by: "Group the items", http_request: "Call a web address", if: "Check a condition", loop: "Repeat for each item", parallel: "Do these at the same time", paths: "Choose a path",
  post_message: "Post a chat message", send_email: "Send an email", send_sms: "Send a text message", sign: "Send for signature", start_journey: "Start a journey", stop: "Stop here", transform: "Reshape the data",
  wait: "Wait", wait_stage: "Wait for a journey stage",
};
const PROVIDERS = new Set(["Google", "Microsoft", "GitHub"]);

/** "Google · Create a calendar event" as "Create a calendar event in Google"; "Files · Move a file" as "Move a file". */
export function plainKindTitle(key: string, registryTitle?: string): string {
  if (KIND_WORDS[key] !== undefined) return KIND_WORDS[key] as string;
  if (registryTitle !== undefined && registryTitle !== "") {
    const m = /^([^·]+)·\s*(.+)$/.exec(registryTitle);
    if (m) return PROVIDERS.has((m[1] as string).trim()) ? `${m[2]} in ${(m[1] as string).trim()}` : (m[2] as string);
    return registryTitle;
  }
  const words = sayWords(key.split(".").slice(-1)[0] ?? key);
  return words === "" ? "" : words.charAt(0).toUpperCase() + words.slice(1);
}

/** The step as a person names it. `position` is its place in the flow, 1 for the first, used when nothing else says what it is. */
export function stepWords(n: StepNode, registryTitle?: string, position?: number): string {
  const title = (n.title ?? "").trim();
  if (title !== "" && !idLike(title)) return title;
  if (n.key === "wait") {
    const i = n.input ?? {};
    const d = durationWords(i["forDuration"]) ?? durationWords(i["timeout"]);
    if (d) return `Wait ${d}`;
    if (i["event"] !== undefined) return "Wait for something to happen";
    if (i["hours"] !== undefined) return "Wait for working hours";
  }
  if (n.key !== undefined && n.key !== "") {
    const t = plainKindTitle(n.key, registryTitle);
    if (t !== "") return t;
  }
  return position !== undefined ? `Step ${position}` : "A step";
}
