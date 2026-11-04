// "Add people and agents" in the right pane: the same host and the same sheet as the composer's + and the conversation header. The Crew and Threads tabs each put one row at the top that opens it
// for the open chat, channel or reply thread (the host reads which it is from the thread).
import { useAddSheet } from "../addsheet/index.ts";
import type { AddSheetApi } from "../addsheet/index.ts";
import type { PaneDeps } from "./actions.ts";
import { usePaneData } from "./data.tsx";
import { LeadIcon } from "./parts.tsx";
import type { Entry } from "./parts.tsx";

let seq = 0;

/** The sheet for the open chat, and the pane row that opens it. */
export function usePaneAdd(deps: PaneDeps): { add: AddSheetApi; row: Entry } {
  const data = usePaneData();
  const me = data.me?.id ?? "me";
  const add = useAddSheet({
    call: deps.call, me: { id: me, name: data.nameOf?.(me) ?? "You" }, nameOf: data.nameOf ?? ((id) => id),
    newKey: () => `rp-add-${data.threadId}-${++seq}`, toast: (text) => deps.note(text),
  });
  const row: Entry = { key: "add-people", type: "row", title: "Add people and agents", leading: <LeadIcon name="plus" />, onPress: () => add.open({ threadId: data.threadId }), testID: "pane-add-people" };
  return { add, row };
}
