// The link policy of a Space (ui/reach): for each thing a link points at, what level this person holds, learned from access.reach in batches. Links on screen are asked together, one call
// for all of them; an answer is kept for the session, so a link opens at once the next time and never draws wrong twice. The door (ShellRuntime.open) reads the same answers, so a hover,
// a rendered link and a press agree.
import type { LinkPolicy, LinkState, LinkSubject } from "../../../../../ui/src/reach/index.tsx";
import type { Level } from "./reach.ts";

/** The access resource type of each kind of thing a link names. A kind not listed is not judged by the Space's access (a place's own listing), so its link is live. */
export const RESOURCE_OF: Readonly<Record<string, string>> = {
  thread: "thread", chat: "thread", channel: "channel", file: "file", doc: "file", document: "file", folder: "folder", record: "record", contact: "record", task: "task",
  run: "run", automation: "automation", project: "project", agent: "agent", computer: "computer", vault: "vault_item", item: "vault_item", vault_item: "vault_item",
};

export const keyOf = (s: LinkSubject): string => `${RESOURCE_OF[s.type] ?? s.type}:${s.id}`;

export interface PolicyDeps {
  call(cap: string, input: unknown): Promise<unknown>;
  /** The one quiet line for a peek link with nothing to show. */
  flash?(text: string): void;
  /** How long to gather links before asking (ms). One tick is enough for a list that draws together. */
  wait?: number;
}

export interface Policy extends LinkPolicy {
  /** What is known about a thing, or undefined when it was not asked yet. */
  levelOf(s: LinkSubject): Level | undefined;
  /** Resolves when everything asked so far has an answer. */
  settled(): Promise<void>;
}

export function createLinkPolicy(deps: PolicyDeps): Policy {
  const known = new Map<string, Level>();
  const titles = new Map<string, string>();
  const asked = new Set<string>();
  let pending = new Map<string, { type: string; id: string }>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> = Promise.resolve();
  let v = 0;
  const listeners = new Set<() => void>();
  const bump = (): void => { v += 1; for (const l of [...listeners]) l(); };

  const flush = (): void => {
    timer = null;
    const batch = [...pending.values()];
    pending = new Map();
    if (batch.length === 0) return;
    const chunks: { type: string; id: string }[][] = [];
    for (let i = 0; i < batch.length; i += 200) chunks.push(batch.slice(i, i + 200));
    inflight = Promise.all(chunks.map(async (items) => {
      try {
        const out = (await deps.call("access.reach", { items })) as { items?: Array<{ type: string; id: string; level: Level; title?: string }> };
        for (const r of out.items ?? []) { known.set(`${r.type}:${r.id}`, r.level); if (r.title) titles.set(`${r.type}:${r.id}`, r.title); }
      } catch {
        // the Space did not answer: those links stay live, and the destination checks again; ask again next time they are seen
        for (const it of items) asked.delete(`${it.type}:${it.id}`);
      }
    })).then(bump);
  };

  const prefetch = (subjects: readonly LinkSubject[]): void => {
    let any = false;
    for (const s of subjects) {
      const type = RESOURCE_OF[s.type];
      if (type === undefined) continue;
      const k = `${type}:${s.id}`;
      if (known.has(k) || asked.has(k)) continue;
      asked.add(k);
      pending.set(k, { type, id: s.id });
      any = true;
    }
    if (any && timer === null) timer = setTimeout(flush, deps.wait ?? 0);
  };

  return {
    stateOf(s): LinkState {
      const level = known.get(keyOf(s));
      return level === "none" ? { state: "plain" } : { state: "live" };
    },
    levelOf: (s) => known.get(keyOf(s)),
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    version: () => v,
    prefetch,
    peek(s) { deps.flash?.(titles.get(keyOf(s)) ?? "No summary to show"); },
    async settled() { if (timer !== null) { clearTimeout(timer); flush(); } await inflight; },
  };
}
