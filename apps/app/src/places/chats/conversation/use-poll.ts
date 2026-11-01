// An action card follows the real record while it is open: the one small hook the cards share. It runs `load` again every few seconds while `active`, so a request answered somewhere else
// (another person, another place, the repository itself) changes the card without a refresh. A press that finds the work already decided reloads and shows the decision.
import { useEffect, useRef } from "react";

export function usePoll(load: () => Promise<unknown> | void, active: boolean, ms = 4000): void {
  const fn = useRef(load);
  fn.current = load;
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => { void Promise.resolve(fn.current()).catch(() => undefined); }, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    return () => clearInterval(timer);
  }, [active, ms]);
}
