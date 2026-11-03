// The Space AI accounts a picker lists, loaded once from engine.accounts.list for each kind of work (chats, an automation's AI steps, an agent's own work), so every picker reads the rule the resolver
// itself applies instead of keeping a list of its own. Each row says, per kind of work, whether the account can run it.
import { useEffect, useRef, useState } from "react";
import type { PickRow } from "./pick.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;

interface AccountOut { ref: string; providerId?: string; name?: string; title: string; mine: boolean; status: string; spaceKey?: boolean; usable?: boolean; code?: string; capped?: boolean; capCents?: number | null }

const WORKS = [
  ["chats", (_a?: string) => ({ place: "chat" })],
  ["automations", (_a?: string) => ({ place: "automation", runsAs: "space" })],
  ["agentWork", (a?: string) => ({ place: "agent", ...(a ? { agentId: a } : {}) })],
] as const;

const STATE: Readonly<Record<string, string>> = { ok: "ok", untested: "ok", expired: "needs_sign_in", failed: "failing" };

/** null while loading; an empty list when none, or when the list did not answer. `agentId`: the agent whose own work the "agent" answer is for. */
export function useSpaceAi(call: Call, o: { agentId?: string } = {}): readonly PickRow[] | null {
  const [rows, setRows] = useState<readonly PickRow[] | null>(null);
  // read once: a caller that makes a new function each render must not fetch again each render
  const latest = useRef(call);
  latest.current = call;
  const agent = o.agentId;
  useEffect(() => {
    let live = true;
    const ask = (input: unknown): Promise<AccountOut[] | null> => new Promise<unknown>((resolve) => resolve(latest.current("engine.accounts.list", input))).then((x) => ((x as { accounts?: AccountOut[] } | null)?.accounts ?? null), () => null);
    void Promise.all(WORKS.map(([, input]) => ask(input(agent)))).then((answers) => {
      if (!live) return;
      const first = answers.find((a) => a !== null);
      if (!first) { setRows([]); return; }
      setRows(first.map((p): PickRow => {
        const usableIn: Record<string, { usable: boolean; code?: string }> = {};
        WORKS.forEach(([work], i) => { const r = answers[i]?.find((x) => x.ref === p.ref); if (r && typeof r.usable === "boolean") usableIn[work] = { usable: r.usable, ...(r.code ? { code: r.code } : {}) }; });
        return { id: p.providerId ?? p.ref, name: p.name ?? p.title, scope: p.mine ? "mine" : "shared", handle: p.ref, state: STATE[p.status] ?? "failing", ...(p.spaceKey ? { spaceKey: true } : {}), ...(p.capCents !== undefined ? { capCents: p.capCents } : {}), ...(p.capped ? { capped: true } : {}), usableIn };
      }));
    });
    return () => { live = false; };
  }, [agent]);
  return rows;
}
