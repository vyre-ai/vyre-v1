// The start of the desktop app, before the lock screen: wait a moment for the shell's update check (it began when the app launched). A newer signed version with "Update Vyre automatically"
// on goes behind the Updating screen and the shell installs it and restarts; anything else lets the person in at once. Offline, a failed or slow check never holds the start: the lock screen
// shows, and a late answer only lights the Settings row and its dot. A failed install says so in one line with "Open Vyre anyway"; the next start tries again.
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Opening } from "../../join/kit.tsx";
import { FROM_KEY, STARTUP_WAIT_MS, autoUpdateOn, decide, installFailureWords, isNoSpace, noteUpdateFrom } from "./model.ts";
import type { Progress, Store, UpdateCheck } from "./model.ts";
import { desktopUpdates, localStore, setUpdateState } from "./store.ts";
import type { DesktopUpdates } from "./store.ts";
import { UpdatingScreen } from "./UpdatingScreen.tsx";

export const INSTALL_FAILED = "The update did not install. Vyre will try again next time it opens.";
/** How long a late check may still answer, to light the Settings row. */
const LATE_WAIT_MS = 10_000;

type Stage = { kind: "checking" } | { kind: "open" } | { kind: "updating"; to: string };

/** What the start does once the check has answered (or not): exported for the tests. */
export function startStage(check: UpdateCheck | null, auto: boolean): Stage {
  return decide(check, auto) === "update" && check?.version ? { kind: "updating", to: check.version } : { kind: "open" };
}

export function StartupUpdate(props: { children: ReactNode; updates?: DesktopUpdates | null; store?: Store | null; waitMs?: number }): ReactElement {
  const { children, waitMs = STARTUP_WAIT_MS } = props;
  // read once: the shell's bridge and the store do not change while the app runs
  const [updates] = useState(() => (props.updates === undefined ? desktopUpdates() : props.updates ?? undefined));
  const [store] = useState(() => (props.store === undefined ? localStore() : props.store));
  const [stage, setStage] = useState<Stage>(updates ? { kind: "checking" } : { kind: "open" });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    if (!updates) return undefined;
    let on = true;
    const failed = (e?: unknown): void => {
      try { store?.removeItem(FROM_KEY); } catch { /* nothing kept */ }
      setUpdateState({ installing: false });
      // only a full disk gets words of its own: any other text from the shell stays the one line
      const said = installFailureWords(e, "");
      if (on) setFailure(isNoSpace(said) ? said : INSTALL_FAILED);
    };
    void updates.startup(waitMs).then((check) => {
      if (!on) return;
      if (check.phase === "checking") {
        // not in time: in now, and the answer, when it comes, lights the Settings row and the dot
        setStage({ kind: "open" });
        void updates.startup(LATE_WAIT_MS).then((late) => { if (late.phase !== "checking") setUpdateState({ check: late }); }, () => undefined);
        return;
      }
      setUpdateState({ check });
      const next = startStage(check, autoUpdateOn(store));
      setStage(next);
      if (next.kind !== "updating") return;
      noteUpdateFrom(store, check.current);
      setUpdateState({ installing: true });
      // the shell restarts the app when it is done, so a promise that settles is an install that did not finish
      void updates.install((p) => { if (on) setProgress(p); }).then(failed, failed);
    }, () => { if (on) setStage({ kind: "open" }); });
    return () => { on = false; };
  }, [updates, store, waitMs]);
  if (stage.kind === "checking") return <Opening />;
  if (stage.kind === "updating") return <UpdatingScreen version={stage.to} progress={progress} failure={failure} onOpenAnyway={() => setStage({ kind: "open" })} onStopNow={() => { void updates?.stopNow().catch(() => undefined); }} />;
  return <>{children}</>;
}
