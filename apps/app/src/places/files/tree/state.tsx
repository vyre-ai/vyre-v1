// The Files place's own UI state, shared by the tree and the list: where the list is, the selection, the sort, Quick Look. One reducer (./model.ts).
import { createContext, useContext, useMemo, useReducer } from "react";
import type { Dispatch, ReactElement, ReactNode } from "react";
import { INITIAL_STATE, reduce } from "./model.ts";
import type { Action, FilesState } from "./model.ts";

interface StateApi { state: FilesState; dispatch: Dispatch<Action> }
const Ctx = createContext<StateApi | null>(null);

export function FilesStateProvider({ initial, children }: { initial?: Partial<FilesState>; children: ReactNode }): ReactElement {
  const [state, dispatch] = useReducer(reduce, { ...INITIAL_STATE, ...initial });
  const api = useMemo<StateApi>(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useFilesState(): StateApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("Files needs a FilesStateProvider above it");
  return v;
}
