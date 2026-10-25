// The Records place's own UI state, shared by the sidebar and the table: the open type, the saved view, the folded sections. One reducer (./model.ts).
import { createContext, useContext, useMemo, useReducer } from "react";
import type { Dispatch, ReactElement, ReactNode } from "react";
import { INITIAL_STATE, reduce } from "./model.ts";
import type { Action, RecordsState } from "./model.ts";

interface StateApi { state: RecordsState; dispatch: Dispatch<Action> }
const Ctx = createContext<StateApi | null>(null);

export function RecordsStateProvider({ initial, children }: { initial?: Partial<RecordsState>; children: ReactNode }): ReactElement {
  const [state, dispatch] = useReducer(reduce, { ...INITIAL_STATE, ...initial });
  const api = useMemo<StateApi>(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useRecordsState(): StateApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("Records needs a RecordsStateProvider above it");
  return v;
}
