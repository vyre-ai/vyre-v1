// GitHub: open the issue for a report, and read the webhook that says it closed. Both go through an injected outbound HTTP function, so the contract test
// replays a recorded response and the service never needs the network to be tested.

import type { Bundle } from "./bundle.ts";

export type HttpLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

export interface IssueConfig { repo: string; token: string; outbound: HttpLike }
export interface Issue { number: number; url: string }

/** Text that is safe inside a markdown table cell or code span: no newlines, no backticks, no pipes, no angle brackets. */
export const inline = (s: string, max = 200): string => s.replace(/[\r\n]+/g, " ").replace(/[`|<>]/g, "'").slice(0, max);

export const issueTitle = (b: Bundle, id: string): string => {
  const note = (b.note ?? "").split(/\r?\n/)[0] ?? "";
  const what = note.trim() ? inline(note, 70) : inline(b.context.place, 70);
  return `[report] ${what} (${id})`;
};

export function issueBody(b: Bundle, o: { reportId: string; spaceId: string; screenshotUrl: string | null; bundleUrl: string | null }): string {
  const lines: string[] = [];
  lines.push(`Problem report \`${o.reportId}\` from Space \`${o.spaceId}\`.`, "");
  lines.push("| | |", "|---|---|");
  lines.push(`| Place | \`${inline(b.context.place)}\` |`);
  if (b.context.itemId) lines.push(`| Item | \`${inline(b.context.itemId)}\` |`);
  lines.push(`| App | ${inline(b.versions.app, 64)} |`, `| Server | ${inline(b.versions.server, 64)} |`, `| Device | ${inline(b.versions.device)} |`);
  lines.push("", "**Trace ids**", "");
  if (b.traceIds.length) for (const t of b.traceIds) lines.push(`- \`${t}\``);
  else lines.push("- none captured");
  // the person's words go in a code fence: GitHub shows them as typed and renders nothing in them (no links, no images, no mentions)
  if (b.note) lines.push("", "**What the person wrote**", "", "```text", ...b.note.split(/\r?\n/).map((l) => inline(l, 500)), "```");
  lines.push("", "**Steps (last events)**", "");
  const events = b.events.slice(-20);
  if (events.length) for (const e of events) lines.push(`- ${new Date(e.at).toISOString()} \`${inline(e.type, 100)}\`${e.traceId ? ` \`${e.traceId}\`` : ""}`);
  else lines.push("- none captured");
  if (b.errors && b.errors.length) {
    lines.push("", "**Errors**", "");
    for (const e of b.errors.slice(-10)) lines.push(`- \`${inline(e.code, 100)}\` ${inline(e.message, 300)}${e.traceId ? ` (\`${e.traceId}\`)` : ""}`);
  }
  if (o.screenshotUrl) lines.push("", `Screenshot: ${o.screenshotUrl}`);
  if (o.bundleUrl) lines.push(`Full bundle: ${o.bundleUrl}`);
  return lines.join("\n");
}

/** POST /repos/<repo>/issues labelled bug. Throws with a status the caller can retry on. */
export async function openIssue(c: IssueConfig, title: string, body: string): Promise<Issue> {
  const res = await c.outbound(`https://api.github.com/repos/${c.repo}/issues`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.token}`, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28", "user-agent": "vyre-reports" },
    body: JSON.stringify({ title, body, labels: ["bug"] }),
  });
  const raw = await res.text();
  if (res.status !== 201) throw Object.assign(new Error(`github answered ${res.status}`), { status: res.status });
  let j: unknown;
  try { j = JSON.parse(raw); } catch { throw Object.assign(new Error("github answered with something that is not JSON"), { status: 502 }); }
  const o = j as { number?: unknown; html_url?: unknown };
  if (typeof o.number !== "number" || !Number.isInteger(o.number) || typeof o.html_url !== "string") throw Object.assign(new Error("github's answer has no issue number"), { status: 502 });
  return { number: o.number, url: o.html_url };
}

export interface ClosedIssue { number: number; fixedIn: string | null }

/** From a GitHub `issues` webhook body: the issue that was closed, with the `fixed-in-<version>` label if it has one. Null for anything else. */
export function closedIssue(event: string, payload: unknown): ClosedIssue | null {
  if (event !== "issues" || typeof payload !== "object" || payload === null) return null;
  const p = payload as { action?: unknown; issue?: { number?: unknown; labels?: unknown } };
  if (p.action !== "closed" || typeof p.issue?.number !== "number") return null;
  let fixedIn: string | null = null;
  if (Array.isArray(p.issue.labels)) {
    for (const l of p.issue.labels) {
      const name = typeof l === "string" ? l : typeof l === "object" && l !== null ? (l as { name?: unknown }).name : null;
      const m = typeof name === "string" ? /^fixed-in-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(name) : null;
      if (m?.[1]) fixedIn = m[1];
    }
  }
  return { number: p.issue.number, fixedIn };
}
