// Install from a link: the words and small decisions behind the held card, the update card and the Skills list, kept apart from the screen so a test can read them. No capability is called here.
import type { CapMap } from "../../../../../../../generated/types.ts";

export type Plan = CapMap["install.get"]["out"]["plan"];
export type Scope = "me" | "agent" | "space";
export type RunOn = "sandbox" | "space";

export const KIND_WORDS: Readonly<Record<Plan["kind"], string>> = { skill: "a skill", plugin: "a plugin", mcp_local: "a local MCP server", mcp_remote: "a remote MCP server", site: "a site" };
export const SCOPE_WORDS: Readonly<Record<Scope, string>> = { me: "you", agent: "this agent", space: "everyone in the Space" };
export const SCOPES: ReadonlyArray<{ key: Scope; label: string }> = [{ key: "me", label: "Just you" }, { key: "agent", label: "This agent" }, { key: "space", label: "Everyone in the Space" }];

/** The card's title: "Install pdf-forms (a skill)", or for an update "pdf-forms 1.2.0 to 1.3.0". */
export const titleOf = (p: Pick<Plan, "name" | "kind" | "diff">): string => (p.diff ? `${p.name} ${shortOf(p.diff.from)} to ${shortOf(p.diff.to)}` : `Install ${p.name} (${KIND_WORDS[p.kind]})`);
export const shortOf = (commit: string): string => commit.slice(0, 7);

/** What it needs, in the card's two lines: the web addresses it reaches, and the Vault keys it wants. "none" where it asks for nothing. */
export function needsLines(p: Pick<Plan, "needs">): { network: string; vault: string; files: string } {
  const j = (l: readonly string[]): string => (l.length === 0 ? "none" : l.join(", "));
  return { network: j(p.needs.domains), vault: j(p.needs.vaultKeys), files: j(p.needs.files) };
}

/** Where the commit is pinned: the seven characters. A remote MCP server has no commit, so the card says whose server it is. */
export const pinnedLine = (p: Pick<Plan, "commit" | "kind">): { label: string; value: string } =>
  p.commit ? { label: "Pinned to", value: shortOf(p.commit) } : { label: "Version", value: "Not pinned. It is their server." };

/** Which "For" choices the person has: everyone in the Space is for an admin. */
export const choices = (p: Pick<Plan, "who">): Array<{ key: Scope; label: string; allowed: boolean }> => p.who.map((w) => ({ key: w.key, label: w.label, allowed: w.allowed }));

/** The quiet line after an install. */
export function doneLine(name: string, scope: Scope, runOn?: RunOn): string {
  return `Installed ${name} for ${SCOPE_WORDS[scope]}${runOn === "space" ? " · runs on the Space" : runOn === "sandbox" ? " · runs in your agent's sandbox" : ""}`;
}

/** The lines of one changed file in an update, as the diff card draws them: a heading, then removed and added lines. */
export function diffRows(d: NonNullable<Plan["diff"]>): Array<{ kind: "head" | "add" | "del" | "note"; text: string }> {
  const rows: Array<{ kind: "head" | "add" | "del" | "note"; text: string }> = [];
  for (const c of d.changed) { rows.push({ kind: "head", text: c.path }); for (const m of c.minus) rows.push({ kind: "del", text: `- ${m}` }); for (const a of c.plus) rows.push({ kind: "add", text: `+ ${a}` }); }
  for (const a of d.added) rows.push({ kind: "head", text: `${a} (new)` });
  for (const r of d.removed) rows.push({ kind: "head", text: `${r} (removed)` });
  return rows;
}
export const changedCount = (d: NonNullable<Plan["diff"]>): number => d.changed.length + d.added.length + d.removed.length;

/** The note under an update's diff when it reaches somewhere new. Names only what is new against what the install already named. */
export function newAccess(now: Plan["needs"], was: Plan["needs"] | undefined): string[] {
  const had = new Set([...(was?.domains ?? []), ...(was?.vaultKeys ?? [])]);
  return [...now.domains, ...now.vaultKeys].filter((x) => !had.has(x));
}

/** A skill's second line in the Skills list: its version, then where it came from. */
export const skillLine = (s: { version: string; source: string }): string => [s.version ? `v${s.version}` : "", sourceWords(s.source)].filter(Boolean).join(" · ");
export function sourceWords(source: string): string {
  if (source.startsWith("github:")) return source.slice(7).replace(/@[^/]*/, "").split("/").slice(0, 2).join("/");
  if (source === "agent") return "Written by its agent";
  if (source === "upload" || source === "") return "Added by hand";
  return source.replace(/^link:/, "");
}

/** History row: "v3 · 4 Nov · pdf-tools updated to 7d03be8". */
export function historyLine(r: { rev: number; at: number; summary: string; by: string; authorKind: "person" | "agent" }, nameOf: (id: string) => string): string {
  const d = new Date(r.at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `v${r.rev} · ${d} · ${r.summary}${r.authorKind === "agent" ? ` · ${nameOf(r.by)}` : ""}`;
}
