// The values behind Console, AI, Internet access (the setting engine.egress, modules/engine/sandbox-default.ts EgressPolicy): what each choice means, the hosts an admin types, and the sentence the
// review shows before the change is applied. Plain functions, so the page and its test share them.
export type InternetMode = "public" | "providers" | "list";
export interface InternetPolicy { mode: InternetMode; hosts: string[] }

export const INTERNET_CHOICES: ReadonlyArray<{ key: InternetMode; title: string }> = [
  { key: "public", title: "Anything public (default)" },
  { key: "providers", title: "Only the AI providers" },
  { key: "list", title: "A list I choose" },
];

const HOST = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The setting as read back; anything unreadable is the default. */
export function internetPolicy(v: unknown): InternetPolicy {
  const o = (v !== null && typeof v === "object" ? v : {}) as { mode?: unknown; hosts?: unknown };
  const mode: InternetMode = o.mode === "providers" || o.mode === "list" ? o.mode : "public";
  return { mode, hosts: Array.isArray(o.hosts) ? o.hosts.filter((h): h is string => typeof h === "string") : [] };
}

/**
 * The hosts an admin typed, one per line or separated by commas or spaces. A pasted address is cut to its host (https://github.com/x becomes github.com) and lower-cased; `*.example.com` stands for
 * every name under example.com. What is still not a host name is returned in `bad`, so the page can say which.
 */
export function parseHosts(text: string): { hosts: string[]; bad: string[] } {
  const hosts: string[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    if (raw === "") continue;
    let h = raw.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
    h = h.split(/[/?#]/)[0] ?? "";
    h = h.replace(/:\d+$/, "").replace(/\.$/, "");
    if (HOST.test(h)) { if (!hosts.includes(h)) hosts.push(h); } else bad.push(raw);
  }
  return { hosts, bad };
}

/** What the change will do, in one sentence for the review. */
export function internetSummary(p: InternetPolicy): string {
  if (p.mode === "public") return "AI tools can reach any public website or service. Private, local and this computer's own addresses stay blocked.";
  if (p.mode === "providers") return "AI tools can reach only the AI providers. Fetching web pages, installing packages and cloning repositories will be blocked.";
  return p.hosts.length === 0
    ? "AI tools can reach only the AI providers until you add hosts."
    : `AI tools can reach the AI providers and ${p.hosts.length === 1 ? "1 host" : `${p.hosts.length} hosts`}: ${p.hosts.slice(0, 5).join(", ")}${p.hosts.length > 5 ? ", and more" : ""}.`;
}

/**
 * How the choice holds on Windows (RULINGS 14 and 15): a Team Space turn on a member's Windows computer runs in a sealed Linux sandbox, where the choice is enforced as on a server; a Personal Space's
 * AI tools on Windows run with the person's own access to the internet, the choice steering them through Vyre's proxy without sealing them in.
 */
export const WINDOWS_NOTE = "On Windows, team chats run in a sealed Linux sandbox, where this choice holds as it does on a server. In a Personal Space on Windows the choice guides the AI tools through Vyre's proxy, but a program can still reach the internet directly: it is the person's own computer.";
