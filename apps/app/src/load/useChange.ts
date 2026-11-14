// The hook for a change (contract P3): today's `useAction` of the Console, as the one rule. One call at a time (a different call waits its turn; the same call again while it runs is the double
// press and is ignored; at most MAX_WAITING_CHANGES wait), one idempotency key per call, and a note in plain words that keeps a failure while later calls succeed.
// `optimistic` is for the few writes that are safe to show before they are answered (a switch, a star, a read mark, an order): the patch is applied to the watched answer at once and undone if the
// call fails. Anything the Gate can hold or refuse (a send, a grant) passes no `optimistic` and waits for its answer.
import { useCallback, useRef, useState } from "react";
import { errorSentence } from "../errors/details.ts";
import { useCapCall } from "./call.tsx";
import { useScreens } from "./screens.tsx";

/** The most changes that may wait behind the running one; a held key or a runaway loop cannot grow the queue without bound. */
export const MAX_WAITING_CHANGES = 20;

export interface Patch {
  /** The watched read to change, and its input. */
  cap: string;
  input?: Record<string, unknown>;
  apply(data: unknown): unknown;
}
export interface ChangeOptions {
  optimistic?(input: unknown): Patch | readonly Patch[];
}
export interface Change {
  /** Runs the change. Answers its result, or undefined when it failed or was ignored. `success` is the note when it went through. */
  run<T = unknown>(input: unknown, success?: string): Promise<T | undefined>;
  busy: boolean;
  note: string;
}

const keyOf = (): string => globalThis.crypto?.randomUUID?.() ?? `change-${Date.now()}-${Math.random()}`;

export function useChange(cap: string, options: ChangeOptions = {}): Change {
  const call = useCapCall();
  const screens = useScreens() as {
    patch?: (cap: string, input: Record<string, unknown>, apply: (d: unknown) => unknown) => () => void;
  };
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const carry = useRef("");
  // the call asked for last and how many are running or waiting: a press that repeats the last one asked is the double press; a press that repeats an earlier one (on, off, on) is a new change
  const last = useRef("");
  const pending = useRef(0);
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef({ call, screens, options });
  latest.current = { call, screens, options };
  // setting state after the page has closed is ignored by React, so there is no mounted guard to keep
  const say = setNote;

  const run = useCallback(
    <T>(input: unknown, success = ""): Promise<T | undefined> => {
      const digest = cap + JSON.stringify(input);
      if (pending.current > 0 && last.current === digest) return Promise.resolve(undefined);
      if (pending.current > MAX_WAITING_CHANGES) {
        carry.current = "Too many changes are waiting. Let the earlier ones finish, then try again.";
        say(carry.current);
        return Promise.resolve(undefined);
      }
      if (pending.current === 0) carry.current = "";
      pending.current++;
      last.current = digest;
      // shown before it is answered: a patch of the watched answer, undone below if the call fails
      const undo: (() => void)[] = [];
      const o = latest.current.options.optimistic?.(input);
      if (o)
        for (const p of Array.isArray(o) ? o : [o])
          undo.push(latest.current.screens.patch?.(p.cap, p.input ?? {}, p.apply) ?? (() => undefined));
      const mine = tail.current.then(async (): Promise<T | undefined> => {
        setBusy(true);
        try {
          const out = (await latest.current.call(cap, input, { idempotencyKey: keyOf() })) as T;
          say([carry.current, success].filter(Boolean).join(" "));
          return out;
        } catch (e) {
          for (const u of undo) u();
          carry.current = [carry.current, errorSentence(e)].filter(Boolean).join(" ");
          say(carry.current);
          return undefined;
        } finally {
          pending.current--;
          if (pending.current === 0) setBusy(false);
        }
      });
      tail.current = mine.catch(() => undefined);
      return mine;
    },
    [cap],
  );
  return { run, busy, note };
}
