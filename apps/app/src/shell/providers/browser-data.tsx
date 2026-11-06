// The agent's profile in the Space browser for the Computer tab's Browser section: read from computers.browser.profiles (polled, it has no live query), driven with take_over, give_back and stream, and drawn
// live by BrowserLive. Who may take over is the server's rule (agents.share_class); the row's `access` says it for the viewer: owner and admin may, a viewer may watch only. A refusal comes back as the
// server's sentence ("Waiting for room on the Space browser" when it is full).
import type { ReactElement } from "react";
import { BrowserLive } from "../../places/chats/rightpane/BrowserLive.tsx";
import type { BrowserData, BrowserView } from "../../places/chats/rightpane/work-model.ts";

export interface BrowserRowLike { agentId: string; running: boolean; tabs: number; busy: boolean; viewers: number; lastActiveAt?: number | undefined; takeoverBy?: string | undefined; paired: boolean; access: "owner" | "admin" | "viewer" }

/** The profile as the pane draws it. A profile that is not listed has not started: closed, and the person's own say over it comes from the server when they ask. */
export function browserView(agentId: string, rows: readonly BrowserRowLike[], d: { me: string; nameOf(id: string): string }): BrowserView {
  const r = rows.find((x) => x.agentId === agentId);
  if (!r) return { state: "closed", canTakeOver: true, sites: [] };
  const may = r.access === "owner" || r.access === "admin";
  const base = { canTakeOver: may, ...(may ? {} : { cannotTakeOver: "You can watch this browser but not take it over." }), sites: [] as BrowserView["sites"] };
  if (r.takeoverBy) return { ...base, state: "takeover", tabs: r.tabs, takenBy: r.takeoverBy === d.me ? "You" : d.nameOf(r.takeoverBy), mine: r.takeoverBy === d.me };
  return { ...base, state: r.running ? "open" : "closed", ...(r.running ? { tabs: r.tabs, ...(r.busy ? { caption: "Working in it now" } : {}) } : {}) };
}

const sentence = (e: unknown): string => (e instanceof Error && e.message ? e.message : "That did not work. Try again.");
const POLL_MS = 3000;

export function browserData(d: {
  call(cap: string, input: unknown): Promise<unknown>; me: string; nameOf(id: string): string; spaceUrl?: string | undefined; note?(text: string): void;
  every?(f: () => void, ms: number): () => void;
}): BrowserData {
  const every = d.every ?? ((f, ms) => { const t = setInterval(f, ms); return () => clearInterval(t); });
  const refreshers = new Set<() => void>();
  const act = async (cap: string, agentId: string): Promise<void> => {
    try { await d.call(cap, { agentId }); } catch (e) { throw new Error(sentence(e)); }
    for (const r of refreshers) r();
  };
  return {
    watch(agentId, on) {
      let live = true;
      const pull = (): void => {
        void Promise.resolve(d.call("computers.browser.profiles", {})).then((o) => { if (live) on(browserView(agentId, (o as { profiles?: BrowserRowLike[] }).profiles ?? [], d)); }, () => undefined);
      };
      refreshers.add(pull);
      pull();
      const stop = every(pull, POLL_MS);
      return () => { live = false; refreshers.delete(pull); stop(); };
    },
    // opening the live view wakes the browser; it is the same call that hands out the address
    async open(agentId) { try { await d.call("computers.browser.stream", { agentId }); } catch (e) { throw new Error(sentence(e)); } for (const r of refreshers) r(); },
    takeOver: (agentId) => act("computers.browser.take_over", agentId),
    giveBack: (agentId) => act("computers.browser.give_back", agentId),
    async signOut() { throw new Error("Signing out of a site is not available in the Space browser yet."); },
    renderLive: (agentId, o): ReactElement => <BrowserLive agentId={agentId} control={o.control} call={d.call} spaceUrl={d.spaceUrl} onNote={d.note} />,
  };
}
