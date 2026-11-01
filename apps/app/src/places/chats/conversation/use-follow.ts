// An action card follows the real object while it is open: the one small hook the cards share. The Space's live stream says something changed (and the session's own slow poll says so when the link is down), and
// `load` runs again, so a request answered somewhere else (another person, another place, the repository itself) changes the card without a refresh. Nothing here keeps time: a card that is not `active` reads nothing,
// and a tick that lands while a read is out runs one more read after it.
import { useEffect, useRef } from "react";

export interface Changes { subscribe(listener: () => void): () => void }

export function useFollow(changes: Changes | undefined, load: () => Promise<unknown> | void, active: boolean): void {
  const fn = useRef(load);
  fn.current = load;
  useEffect(() => {
    if (!active || !changes) return undefined;
    let reading = false, again = false, gone = false;
    const read = (): void => {
      if (gone) return;
      if (reading) { again = true; return; }
      reading = true;
      void Promise.resolve().then(() => fn.current()).catch(() => undefined).finally(() => { reading = false; if (again) { again = false; read(); } });
    };
    const off = changes.subscribe(read);
    return () => { gone = true; off(); };
  }, [active, changes]);
}
