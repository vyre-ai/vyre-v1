// The Inbox's own UI state, shared by the sidebar and the list: the view, the scope, the filters, the selected row, the folded sections. One reducer (./model.ts), so every
// click is one named action and the state is easy to test. The shell may seed it (a deep link opens the Following list) and may keep it per Space.
import { createContext, useContext, useMemo, useReducer } from "react";
import type { Dispatch, ReactElement, ReactNode } from "react";
import { INITIAL_STATE, reduce } from "./model.ts";
import type { Action, InboxState } from "./model.ts";

interface StateApi { state: InboxState; dispatch: Dispatch<Action> }
const Ctx = createContext<StateApi | null>(null);

export function InboxStateProvider({ initial, children }: { initial?: Partial<InboxState>; children: ReactNode }): ReactElement {
  const [state, dispatch] = useReducer(reduce, { ...INITIAL_STATE, ...initial });
  const api = useMemo<StateApi>(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useInboxState(): StateApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("The Inbox needs an InboxStateProvider above it");
  return v;
}
