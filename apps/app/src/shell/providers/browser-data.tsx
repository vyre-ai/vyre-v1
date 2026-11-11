// The agent's profile in the Space browser for the Computer tab's Browser section: read from computers.browser.profiles (polled, it has no live query), driven with take_over, give_back and stream, and drawn
// live by BrowserLive. Who may take over is the server's rule (agents.share_class); the row's `access` says it for the viewer: owner and admin may, a viewer may watch only. A refusal comes back as the
// server's sentence ("Waiting for room on the Space browser" when it is full).
import type { ReactElement } from "react";
import { BrowserLive } from "../../places/chats/rightpane/BrowserLive.tsx";
import type { BrowserData, BrowserView } from "../../places/chats/rightpane/work-model.ts";

export interface BrowserRowLike { agentId: string; state?: "running" | "asleep" | "waiting" | "error" | undefined; line?: string | undefined; running: boolean; tabs: number; busy: boolean; viewers: number; lastActiveAt?: number | undefined; takeoverBy?: string | undefined; paired: boolean; access: "owner" | "admin" | "viewer" }

/** The profile as the pane draws it. A profile that is not listed has not started: closed, and the person's own say over it comes from the server when they ask. */
export function browserView(agentId: string, rows: readonly BrowserRowLike[], d: { me: string; nameOf(id: string): string }, sites: BrowserView["sites"] = []): BrowserView {
  const r = rows.find((x) => x.agentId === agentId);
  if (!r) return { state: "closed", canTakeOver: true, sites: [] };
  const may = r.access === "owner" || r.access === "admin";
  const base = { canTakeOver: may, ...(may ? {} : { cannotTakeOver: "You can watch this browser but not take it over." }), sites: may ? sites : [] };
  if (r.takeoverBy) return { ...base, state: "takeover", tabs: r.tabs, takenBy: r.takeoverBy === d.me ? "You" : d.nameOf(r.takeoverBy), mine: r.takeoverBy === d.me };
  if (r.state === "waiting") return { ...base, state: "waiting", ...(r.line ? { line: r.line } : {}) };
  if (r.state === "error") return { ...base, state: "error", ...(r.line ? { line: r.line } : {}) };
  return { ...base, state: r.running ? "open" : "closed", ...(r.running ? { tabs: r.tabs, ...(r.busy ? { caption: "Working in it now" } : {}) } : {}) };
}

/** The line for a Space with no browser to run: what the server said, with the way out. */
export function unavailableLine(e: unknown): string {
  const said = e instanceof Error ? e.message : "";
  return /not running on this host/i.test(said) ? "This Space has nowhere to run a browser yet. Add a compute server in Console > Computers." : said || "The browser could not be reached. It will try again.";
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
      let shown = false;
      const pull = (): void => {
        void (async () => {
          const rows = ((await d.call("computers.browser.profiles", {})) as { profiles?: BrowserRowLike[] }).profiles ?? [];
          // its logins are for a person who may take it over; a sleeping browser answers from the list saved when it closed, and is not woken
          const r = rows.find((x) => x.agentId === agentId);
          let sites: BrowserView["sites"] = [];
          if (r && (r.access === "owner" || r.access === "admin")) {
            try { sites = ((await d.call("computers.browser.sessions", { agentId })) as { sessions?: Array<{ site: string; signedInAs?: string; since: number }> }).sessions?.map((x) => ({ site: x.site, ...(x.signedInAs ? { signedInAs: x.signedInAs } : {}), since: x.since })) ?? []; } catch { /* the list stays empty */ }
          }
          if (live) { shown = true; on(browserView(agentId, rows, d, sites)); }
        })().catch((e: unknown) => {
          // a Space that cannot run a browser answers every read with a refusal: say so in one plain line instead of drawing a placeholder that never fills. A later good answer replaces it.
          if (live && !shown) on({ state: "error", canTakeOver: false, sites: [], line: unavailableLine(e) });
        });
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
    async signOut(agentId, site) { try { await d.call("computers.browser.sign_out", { agentId, site }); } catch (e) { throw new Error(sentence(e)); } for (const r of refreshers) r(); },
    renderLive: (agentId, o): ReactElement => <BrowserLive agentId={agentId} control={o.control} call={d.call} spaceUrl={d.spaceUrl} onNote={d.note} />,
  };
}
