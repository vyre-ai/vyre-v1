// Vault > Connections, the Browser kind (Chrome step 2): a site agents may use, where it runs (My Chrome, agent computers, or both) and what each agent may do there (Read only, or Act).
// The words and the draft, with no screen; the rows come from browser.sites.list. A send, a post, a payment and a delete are held for the person whatever the right.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConnRow } from "./model.ts";

export type BrowserSite = CapMap["browser.sites.list"]["out"]["sites"][number];
export type RunsIn = BrowserSite["runsIn"];
export type Right = "off" | "read" | "act";

export const RUNS: ReadonlyArray<{ key: RunsIn; label: string }> = [{ key: "chrome", label: "My Chrome" }, { key: "computers", label: "Agent computers" }, { key: "both", label: "Both" }];
export const RIGHTS: ReadonlyArray<{ key: Right; label: string }> = [{ key: "off", label: "No access" }, { key: "read", label: "Read only" }, { key: "act", label: "Act" }];
export const ALWAYS_HELD = "Sends, posts, payments and deletes are always held for you to approve, whatever an agent may do.";

export const runsWords = (r: RunsIn): string => (r === "chrome" ? "My Chrome" : r === "computers" ? "Agent computers" : "My Chrome and agent computers");

/** "Scout acts, Intake reads", or "No agent yet". */
export function rightsLine(rights: BrowserSite["rights"], agentName: (id: string) => string): string {
  if (rights.length === 0) return "No agent yet";
  const acts = rights.filter((r) => r.right === "act").map((r) => agentName(r.agentId));
  const reads = rights.filter((r) => r.right === "read").map((r) => agentName(r.agentId));
  const join = (names: string[]): string => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`);
  return [acts.length ? `${join(acts)} ${acts.length === 1 ? "acts" : "act"}` : "", reads.length ? `${join(reads)} ${reads.length === 1 ? "reads" : "read"}` : ""].filter(Boolean).join(" · ");
}

/** One site as a row of the list: the host as its name, where it runs and what the agents may do. */
export function siteRow(site: BrowserSite, agentName: (id: string) => string): ConnRow {
  return {
    id: site.id, kind: "browser", title: site.host, what: `Browser · ${runsWords(site.runsIn)}`, section: "mine", health: "ok",
    who: rightsLine(site.rights, agentName), usedBy: [], oauth: false, share: [], canManage: true, keys: [], needs: [], site,
  };
}

export interface Draft { host: string; runsIn: RunsIn; rights: Record<string, Right> }
export const emptyDraft = (): Draft => ({ host: "", runsIn: "chrome", rights: {} });
export const draftOf = (s: BrowserSite): Draft => ({ host: s.host, runsIn: s.runsIn, rights: Object.fromEntries(s.rights.map((r) => [r.agentId, r.right] as const)) });

/** The host a person typed: an address, a path or capitals mean the same site. Mirrors the module's own rule (modules/browser/projections.ts hostOf). */
export function hostOf(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s || /[\s*]/.test(s)) return null;
  let h = s;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) { try { h = new URL(s).hostname; } catch { return null; } } else h = (s.split(/[/?#]/)[0] ?? "").replace(/:\d+$/, "");
  h = h.replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(h) || h.startsWith(".") || h.includes("..")) return null;
  return h === "localhost" || h.includes(".") ? h : null;
}

/** What Save sends, or why it cannot. */
export function inputOf(d: Draft): { ok: true; input: { host: string; runsIn: RunsIn; rights: Array<{ agentId: string; right: "read" | "act" }> } } | { ok: false; why: string } {
  const host = hostOf(d.host);
  if (!host) return { ok: false, why: "Give the site's address, like app.gohighlevel.com." };
  const rights = Object.entries(d.rights).filter(([, r]) => r !== "off").map(([agentId, right]) => ({ agentId, right: right as "read" | "act" }));
  return { ok: true, input: { host, runsIn: d.runsIn, rights } };
}
