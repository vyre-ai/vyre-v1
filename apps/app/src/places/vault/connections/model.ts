// Vault > Connections, the model: one list of every connection from three sources, in two sections (Mine and Space, and the agents' own when there are any), with the words each row shows.
// Pure functions over what plugins.connections.home, connections.list and connectors.list answer, so the page, Settings, the Console summary and the tests read the same thing.
//   MCP connections and hubs (agents module): health, who can use it, which agents used it, last used.
//   Plugin servers: listed where their plugin is; managed on the plugin.
//   Built-in integrations (Google, Microsoft, Slack, Zoom and the rest: the connectors module's accounts): a person's own or the Space's.
import type { CapMap } from "../../../../../../generated/types.ts";
import { siteRow } from "./browser.ts";

export type Home = CapMap["plugins.connections.home"]["out"];
export type HomeRow = Home["mine"][number];
export type Account = CapMap["connections.list"]["out"]["connections"][number];
export type Connector = CapMap["connectors.list"]["out"]["connectors"][number];
export type Policy = Home["policy"];

export type Health = HomeRow["health"];
export type Kind = "mcp" | "plugin" | "hub" | "skill" | "app" | "browser";

export interface ConnRow {
  /** Unique across kinds: mcs_..., plg_.../server, con_... */
  id: string;
  kind: Kind;
  title: string;
  /** What it is, in a few words: "MCP server", "From plugin deploy-tools", "From skill pdf", "Google Workspace". */
  what: string;
  section: "mine" | "space" | "agents";
  health: Health;
  healthNote?: string;
  tools?: number;
  /** Who can use it, in words. */
  who: string;
  /** Agent ids that used it, newest first. */
  usedBy: readonly string[];
  usedAt?: number;
  /** The server key agents see, for Test (engine.mcp.tools). Absent for built-in integrations. */
  key?: string;
  connectionId?: string;
  accountId?: string;
  pluginId?: string;
  agentId?: string;
  oauth: boolean;
  share: readonly string[];
  canManage: boolean;
  address?: string;
  keys: readonly string[];
  needs: readonly string[];
  source?: string;
  sourceRef?: string;
  /** A Browser connection's own row (browser.sites.list), for its sheet. */
  site?: import("./browser.ts").BrowserSite;
}

/** The dot's colour: steady, never blinking. Green works, amber wants you, red is broken, grey is off or not checked yet. */
export function dotColor(h: Health): string {
  switch (h) {
    case "ok": return "var(--ok)";
    case "needs_signin": case "needs_setup": return "var(--warn)";
    case "key_refused": case "not_answering": return "var(--danger)";
    default: return "var(--ink-4)";
  }
}

export function healthWords(h: Health, tools?: number): string {
  switch (h) {
    case "ok": return tools !== undefined ? `Working, ${tools} ${tools === 1 ? "tool" : "tools"}` : "Working";
    case "needs_signin": return "Needs sign-in";
    case "needs_setup": return "Needs setup";
    case "key_refused": return "Key refused";
    case "not_answering": return "Not answering";
    case "off": return "Off";
    default: return "Not checked yet";
  }
}

/** "2 min ago", "3 h ago", "4 Nov". Never a raw timestamp. */
export function agoWords(at: number | undefined, now: number): string {
  if (!at) return "Never used";
  const d = Math.max(0, now - at);
  if (d < 60_000) return "Used just now";
  if (d < 3_600_000) return `Used ${Math.floor(d / 60_000)} min ago`;
  if (d < 86_400_000) return `Used ${Math.floor(d / 3_600_000)} h ago`;
  if (d < 7 * 86_400_000) return `Used ${Math.floor(d / 86_400_000)} d ago`;
  return `Used ${new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

const accountHealth = (state: Account["state"]): Health =>
  state === "active" ? "ok" : state === "pending" || state === "needs_reconnect" ? "needs_signin" : state === "failing" ? "not_answering" : "off";

/** Who a Space connection reaches, in words. */
export function shareWords(share: readonly string[], groupName: (id: string) => string): string {
  if (share.length === 0 || share.includes("everyone")) return "Everyone";
  const names = share.map(groupName);
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

export function whatOf(r: Pick<HomeRow, "kind" | "source" | "sourceRef" | "hub" | "transport">): string {
  if (r.kind === "plugin") return `From plugin ${r.sourceRef ?? ""}`.trim();
  if (r.source === "skill") return r.sourceRef ? `From skill ${r.sourceRef}` : "From a skill";
  if (r.kind === "hub" || r.hub) return "App hub";
  if (r.source === "kit" && r.sourceRef) return `From Kit ${r.sourceRef}`;
  return r.transport === "stdio" ? "MCP server, runs in the sandbox" : "MCP server";
}

export interface Assembled { mine: ConnRow[]; space: ConnRow[]; agents: ConnRow[] }

/** The three sections, each sorted: what needs you first, then by name. */
export function assemble(home: Home | null, accounts: readonly Account[], connectors: readonly Connector[], me: string, groupName: (id: string) => string, agentName: (id: string) => string, sites: readonly import("./browser.ts").BrowserSite[] = []): Assembled {
  const out: Assembled = { mine: [], space: [], agents: [] };
  const title = (key: string): string => connectors.find((c) => c.key === key)?.title ?? key.charAt(0).toUpperCase() + key.slice(1);
  if (home) {
    for (const [section, rows] of [["mine", home.mine], ["space", home.space], ["agents", home.agents]] as const) {
      for (const r of rows) {
        out[section].push({
          id: r.connectionId ?? `${r.pluginId ?? ""}/${r.name}`, kind: r.kind, title: r.title, what: whatOf(r), section, health: r.health, ...(r.healthNote ? { healthNote: r.healthNote } : {}), ...(r.tools !== undefined ? { tools: r.tools } : {}),
          who: section === "mine" ? "You and your agents" : section === "agents" ? `Only ${agentName(r.agentId ?? "")}` : shareWords(r.share, groupName),
          usedBy: r.usedBy, ...(r.usedAt ? { usedAt: r.usedAt } : {}), key: r.key, ...(r.connectionId ? { connectionId: r.connectionId } : {}), ...(r.pluginId ? { pluginId: r.pluginId } : {}), ...(r.agentId ? { agentId: r.agentId } : {}),
          oauth: r.auth === "oauth", share: r.share, canManage: r.canManage, address: r.address, keys: r.keys, needs: r.needs, source: r.source, ...(r.sourceRef ? { sourceRef: r.sourceRef } : {}),
        });
      }
    }
  }
  for (const a of accounts) {
    const mine = a.owner.kind === "person";
    if (mine && a.owner.id !== me) continue;
    out[mine ? "mine" : "space"].push({
      id: a.connectionId, kind: "app", title: a.title || title(a.connector), what: title(a.connector), section: mine ? "mine" : "space", health: accountHealth(a.state),
      who: mine ? "You and your agents" : "Everyone", usedBy: [], ...(a.lastSyncAt ? { usedAt: a.lastSyncAt } : {}), accountId: a.connectionId, oauth: false, share: mine ? [] : ["everyone"], canManage: true, keys: a.handles, needs: [],
    });
  }
  for (const site of sites) out.mine.push(siteRow(site, agentName));
  const rank = (h: Health): number => (h === "key_refused" || h === "not_answering" ? 0 : h === "needs_signin" || h === "needs_setup" ? 1 : 2);
  for (const k of ["mine", "space", "agents"] as const) out[k].sort((x, y) => rank(x.health) - rank(y.health) || x.title.localeCompare(y.title));
  return out;
}

/** The second line of a row: what it is, who can use it, the agents that used it, and when. */
export function noteOf(r: ConnRow, now: number, agentName: (id: string) => string): string {
  if (r.kind === "browser") return [r.what, r.who].join(" · ");
  const parts = [r.what, r.who];
  if (r.usedBy.length > 0) {
    const names = r.usedBy.slice(0, 2).map(agentName);
    parts.push(r.usedBy.length > 2 ? `${names.join(", ")} and ${r.usedBy.length - 2} more` : names.join(" and "));
  }
  parts.push(agoWords(r.usedAt, now));
  return parts.join(" · ");
}

/** The words for Settings and the Console: "4 connections, 1 needs you". */
export function summaryWords(a: Assembled): { line: string; needsYou: number; total: number } {
  const all = [...a.mine, ...a.space, ...a.agents];
  const needsYou = all.filter((r) => r.health === "needs_signin" || r.health === "needs_setup" || r.health === "key_refused" || r.health === "not_answering").length;
  const total = all.length;
  const line = total === 0 ? "None yet" : `${total} ${total === 1 ? "connection" : "connections"}${needsYou > 0 ? `, ${needsYou} ${needsYou === 1 ? "needs" : "need"} a look` : ""}`;
  return { line, needsYou, total };
}

/** A health from what engine.mcp.tools answered for one server: the same reading the engine records. */
export function healthFromTest(r: { ok: boolean; error?: string; tools: readonly unknown[] } | undefined, oauth: boolean): { health: Health; tools?: number; note?: string } {
  if (!r) return { health: "unknown", note: "This connection is not available to your assistant." };
  if (r.ok) return { health: "ok", tools: r.tools.length };
  const e = r.error ?? "";
  if (/needs to be signed in|sign(ed)? in first/i.test(e)) return { health: "needs_signin", note: e };
  if (/answered 401|answered 403|unauthori[sz]ed|forbidden/i.test(e)) return { health: oauth ? "needs_signin" : "key_refused", note: e };
  return { health: "not_answering", note: e };
}

/** A Vault item name from a connection name and a key name: Notion_NOTION_TOKEN. Letters, digits and underscore only. */
export function itemName(conn: string, key: string): string {
  const clean = (s: string): string => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const base = clean(conn).replace(/^./, (c) => c.toUpperCase()) || "Connection";
  return `${base}_${clean(key) || "key"}`.slice(0, 60);
}
