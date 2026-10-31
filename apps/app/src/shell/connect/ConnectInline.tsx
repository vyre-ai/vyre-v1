// The host of connect in place. It sits above every place, holds at most one open flow, draws it as a sheet over the page the person is on and resolves the picker's promise when it ends.
// The real flows live in sheets.tsx and load on first use (the Vault's Add an AI provider and Add item, mail.connect, connections.create).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { ShellRuntime } from "../providers/runtime.tsx";
import { ConnectCtx } from "./context.ts";
import type { Connected, ConnectNeed } from "./model.ts";

const Sheets = lazy(() => import("./sheets.tsx"));

export interface FlowProps {
  rt: ShellRuntime;
  need: ConnectNeed;
  onDone(account: Connected): void;
  onCancel(): void;
}

export function ConnectInlineHost({ rt, render, onConnected, children }: {
  rt: ShellRuntime | null;
  /** Draws the flow. Tests pass their own. The default loads the real sheets. */
  render?(props: { need: ConnectNeed; onDone(account: Connected): void; onCancel(): void }): ReactNode;
  /** After a flow finished with an account. */
  onConnected?(need: ConnectNeed, account: Connected): void;
  children: ReactNode;
}): ReactElement {
  const [flow, setFlow] = useState<{ need: ConnectNeed } | null>(null);
  const [version, setVersion] = useState(0);
  const settle = useRef<((account: Connected | null) => void) | null>(null);
  const latest = useRef(onConnected);
  latest.current = onConnected;
  const close = useCallback((account: Connected | null, need?: ConnectNeed) => {
    const done = settle.current;
    settle.current = null;
    setFlow(null);
    if (account) { setVersion((v) => v + 1); if (need) latest.current?.(need, account); }
    done?.(account);
  }, []);
  const open = useCallback((need: ConnectNeed): Promise<Connected | null> => {
    settle.current?.(null);
    return new Promise<Connected | null>((resolve) => { settle.current = resolve; setFlow({ need }); });
  }, []);
  useEffect(() => () => { settle.current?.(null); settle.current = null; }, []);
  const value = useMemo(() => (rt || render ? { open, version } : null), [rt, render, open, version]);
  const need = flow?.need;
  const body = need
    ? (render
      ? render({ need, onDone: (a) => close(a, need), onCancel: () => close(null) })
      : rt ? <Suspense fallback={null}><Sheets rt={rt} need={need} onDone={(a) => close(a, need)} onCancel={() => close(null)} /></Suspense> : null)
    : null;
  return <ConnectCtx.Provider value={value}>{children}{body}</ConnectCtx.Provider>;
}
