// The Skills page's model (owner ruling 3 Nov): the rows skills.page answers, and the words each one is drawn with. Pure, so the lines are tested without a screen. The same parts draw
// Settings > Skills (every Space) and Console > Skills (the admin's view).

export type Call = (cap: string, input: unknown) => Promise<unknown>;

export interface McpNeed { name: string; transport: "stdio" | "http" | "sse" | "ws"; target: string; keys: string[] }
export interface Perms { scripts: string[]; mcpServers: McpNeed[]; network: string[]; vaultKeys: string[] }
export interface Own {
  skillId: string; name: string; label?: string; description: string; source: string; origin: string; version?: string; projectId?: string; agents: string[]; enabled: boolean; perms: Perms;
  setup: Record<string, string>; needs: string[]; sharedWith: string[]; updatedAt: number;
}
export interface Card {
  skillId: string; name: string; label?: string; description: string; sharer: string; sharerName: string; toSpace: boolean; source: string; origin: string; version?: string; perms: Perms;
  state: "waiting" | "added" | "not_now"; growth: string[]; agents: string[]; enabled: boolean; setup: Record<string, string>; needs: string[]; updatedAt: number;
}
export interface SpaceSkill { skillId: string; name: string; label?: string; description: string; source: string; origin: string; version?: string; enabled: boolean; perms: Perms; setup: Record<string, string>; needs: string[]; from?: string; updatedAt?: number }
export interface Page {
  waiting: Card[]; mine: Own[]; shared: Card[]; space: SpaceSkill[]; builtin: { name: string; description: string }[]; agents: { agentId: string; name: string }[];
  policy: { scriptsAdminOnly: boolean }; admin: boolean; me: string;
}
export interface Preview { name: string; description: string; text: string; files: Record<string, string>; path: string; source: string; kind: "skill" | "plugin" | "codex"; version?: string; perms: Perms; taken?: string }
export interface MemberSkill { owner: string; ownerName: string; name: string; shared: boolean; skillId?: string; toSpace: boolean }

export const titleOf = (s: { name: string; label?: string | undefined }): string => s.label ?? s.name;

/** What a skill can touch, one line each, in words a person reads. "Nothing outside its own text" when it is only instructions. */
export function touchLines(p: Perms): string[] {
  const out: string[] = [];
  if (p.scripts.length > 0) out.push(`Runs ${p.scripts.length === 1 ? "a script" : `${p.scripts.length} scripts`}: ${p.scripts.slice(0, 3).join(", ")}${p.scripts.length > 3 ? ` and ${p.scripts.length - 3} more` : ""}`);
  for (const m of p.mcpServers) out.push(`Starts the ${m.name} tool server (${m.transport === "stdio" ? m.target || "a command" : m.target})${m.keys.length > 0 ? `, which wants ${m.keys.join(", ")}` : ""}`);
  if (p.network.length > 0) out.push(`Reaches ${p.network.join(", ")}`);
  if (p.vaultKeys.length > 0) out.push(`Uses Vault keys ${p.vaultKeys.join(", ")}`);
  return out.length > 0 ? out : ["Nothing outside its own text"];
}

/** Where it came from and which version, in one line: "From acme/skills, version 1.2". */
export function sourceLine(s: { origin: string; version?: string | undefined; source: string }): string {
  const from = s.source === "upload" ? "Added by hand" : s.source === "folder" ? "From a folder" : s.source === "zip" ? "From a zip" : s.source === "assistant" ? "Added by the Assistant" : `From ${s.origin}`;
  return s.version ? `${from}, version ${s.version}` : from;
}

/** Which of the person's agents use it: all of them, none, or their names. */
export function usedByLine(agents: readonly string[], all: readonly { agentId: string; name: string }[]): string {
  if (agents.includes("*")) return "You and all your agents";
  const names = all.filter((a) => agents.includes(a.agentId)).map((a) => a.name);
  if (names.length === 0) return "Only you";
  return `You and ${names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`}`;
}

/** Who a share went to, as the sharer reads it. */
export function sharedLine(to: readonly string[], nameOf: (id: string) => string): string | null {
  if (to.length === 0) return null;
  if (to.includes("*")) return "Shared with everyone here";
  const names = to.map(nameOf);
  return `Shared with ${names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`}`;
}

/** The card's lead line: who shared it, with whom, and why it is back when an update can touch more. */
export function cardLead(c: Card): string {
  const who = `${c.sharerName} shared this ${c.toSpace ? "with everyone here" : "with you"}`;
  return c.growth.length > 0 ? `${c.sharerName} updated it. It now ${c.growth.join("; ")}. Add it again to keep using it.` : who;
}

/** The skills each of the person's agents uses, by name as that agent sees it (a renamed one carries its source). */
export function skillsOfAgent(page: Pick<Page, "mine" | "shared" | "space">, agentId: string): string[] {
  const mine = page.mine.filter((m) => m.enabled && (m.agents.includes("*") || m.agents.includes(agentId))).map(titleOf);
  const shared = page.shared.filter((c) => c.state === "added" && c.enabled && (c.agents.includes("*") || c.agents.includes(agentId))).map(titleOf);
  const space = page.space.filter((s) => s.enabled).map(titleOf);
  return [...mine, ...shared, ...space];
}

/** A Vault item name for a key a skill's server wants: letters, digits and underscores, so it reads as a handle. */
export const vaultItemFor = (skill: string, key: string): string => `${skill}_${key}`.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "Skill_key";

/** The key part of server.KEY. */
export const keyOf = (need: string): { server: string; key: string } => { const i = need.indexOf("."); return { server: need.slice(0, i), key: need.slice(i + 1) }; };

/** A file the person picked or dropped, as base64, for skills.preview. */
export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return globalThis.btoa(s);
}

/** The text files of a picked folder (webkitRelativePath keeps the folder's own paths). Binary files are left out; the server reads only text. */
export async function folderFiles(files: ReadonlyArray<{ name: string; webkitRelativePath?: string; text(): Promise<string>; size: number }>): Promise<{ files: Record<string, string>; hint: string }> {
  const out: Record<string, string> = {};
  let hint = "skill";
  for (const f of files) {
    const p = f.webkitRelativePath && f.webkitRelativePath !== "" ? f.webkitRelativePath : f.name;
    hint = p.split("/")[0] ?? hint;
    if (f.size > 400_000 || /\.(png|jpe?g|gif|webp|ico|pdf|zip|woff2?|ttf|otf|docx?|xlsx?|pptx?)$/i.test(p)) continue;
    const t = await f.text();
    if (!t.includes("\u0000")) out[p] = t;
  }
  return { files: out, hint };
}
