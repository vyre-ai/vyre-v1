// ui/reach: how a link to a thing renders before it is pressed (owner, 4 Nov: never send anyone to a place they cannot open). The app supplies a policy that knows, for a thing
// by type and id, whether this person can open it; a link asks it and draws as a live link, a peek trigger (the same look and a small lock on hover) or plain text with no pointer.
// With no policy (a sandbox, a test) every link is live, as before. The policy batches what it must ask, so every link on screen is answered by one call and renders right the first time.
import { createContext, createElement, useContext, useEffect, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";

export interface LinkSubject { type: string; id: string }
export type LinkState = { state: "live" | "peek" | "plain"; hint?: string };

export interface LinkPolicy {
  /** What this link renders as now. An item not asked about yet is live, and is asked about in the next batch. */
  stateOf(s: LinkSubject): LinkState;
  /** Told when an answer arrives, so the links that asked draw again. */
  subscribe(listener: () => void): () => void;
  /** A change counter: it moves when any answer does. */
  version(): number;
  /** Ask about these now (a list that has its rows asks once, ahead of drawing them). */
  prefetch(subjects: readonly LinkSubject[]): void;
  /** A peek link was pressed. */
  peek(s: LinkSubject): void;
}

const LIVE: LinkState = { state: "live" };
const Ctx = createContext<LinkPolicy | null>(null);

export function LinkPolicyProvider({ value, children }: { value: LinkPolicy | null; children?: ReactNode }): ReactElement {
  return createElement(Ctx.Provider, { value }, children);
}

export const useLinkPolicy = (): LinkPolicy | null => useContext(Ctx);

/** How one link renders. Redraws when the policy learns something, and asks about the link on first sight. */
export function useLinkState(subject: LinkSubject | undefined): LinkState {
  const policy = useContext(Ctx);
  useSyncExternalStore(policy ? policy.subscribe : noop, policy ? policy.version : zero, zero);
  const type = subject?.type;
  const id = subject?.id;
  const asked = policy !== null && type !== undefined && id !== undefined;
  useEffect(() => { if (asked) policy.prefetch([{ type: type as string, id: id as string }]); }, [asked, policy, type, id]);
  if (policy === null || type === undefined || id === undefined) return LIVE;
  return policy.stateOf({ type, id });
}

/** Prefetch a whole list in one go: call it with the subjects of the rows about to draw. */
export function usePrefetch(subjects: readonly LinkSubject[]): void {
  const policy = useContext(Ctx);
  const key = subjects.map((s) => `${s.type}:${s.id}`).join("|");
  useEffect(() => { if (policy !== null && subjects.length > 0) policy.prefetch(subjects); }, [policy, key]);
}

const noop = (): (() => void) => () => undefined;
const zero = (): number => 0;
