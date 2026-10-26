// The Files review surfaces' data context (changeset header, git row, history, diff tabs, lint bar) built from the Space's runtime: live reads over the kept copy, the capability door, names,
// and where a click goes (the shell opens the diff and history screens as tabs).
import type { ReviewData } from "../../places/files/review/index.ts";
import { capLive, nameLookup } from "./records-live.ts";
import type { ShellRuntime } from "./runtime.tsx";

let counter = 0;

/** A fresh idempotency key for one attempt: a random id where the platform has one, else the clock and a counter. */
export function attemptKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `k_${Date.now().toString(36)}_${(counter++).toString(36)}`;
}

export function reviewData(rt: ShellRuntime): ReviewData {
  return {
    live: (cap, input) => capLive(rt, cap, input as Record<string, unknown>),
    call: rt.call,
    nameOf: nameLookup(rt),
    key: attemptKey,
    clock: () => ({ now: rt.clock().now }),
    nav: {
      openChangeset: (changesetId) => rt.open({ screen: "files.diff", args: { changesetId } }),
      compare: (fileId, from, to) => rt.open({ screen: "files.diff", args: { fileId, from, to } }),
      openCommit: (folder, sha) => rt.open({ screen: "files.commit-diff", args: { folder, sha } }),
      settled: () => undefined,
      openHistory: (fileId) => rt.open({ screen: "files.history", args: { fileId } }),
    },
  };
}
