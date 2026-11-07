// Whether the pane has room for faces in the gutter left of the message column (tokens/calm.ts). The conversation measures itself and says so here; a message reads it.
import { createContext, useContext } from "react";

export const GutterContext = createContext<boolean>(false);
export const useGutter = (): boolean => useContext(GutterContext);
