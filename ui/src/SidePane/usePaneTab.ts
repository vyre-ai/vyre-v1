// The hook over ui/SidePane/tab.ts: the tab a thing's pane shows, and how a person changes it.
import { useCallback, useState } from "react";
import { keepTab, openingTab } from "./tab.ts";

/** The selected tab of a thing's side pane and how to change it. Choosing keeps the choice for that thing. */
export function usePaneTab<K extends string>(
  paneKey: string,
  thingId: string,
  keys: readonly K[],
): readonly [K, (k: K) => void] {
  const [chosen, setChosen] = useState<{ id: string; tab: K } | null>(null);
  const id = `${paneKey}:${thingId}`;
  const tab = (chosen && chosen.id === id ? chosen.tab : openingTab(paneKey, thingId, keys)) as K;
  const pick = useCallback(
    (k: K): void => {
      keepTab(paneKey, thingId, k);
      setChosen({ id, tab: k });
    },
    [paneKey, thingId, id],
  );
  return [tab, pick] as const;
}
