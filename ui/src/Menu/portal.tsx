// ui/Menu/portal: a menu is drawn in the root overlay layer (ui/Overlay), not where it was opened, so nothing painted later in the page can cover it.
import type { ReactElement, ReactNode } from "react";
import { Overlay } from "../Overlay/index.tsx";

export { OVERLAY_ROOT_ID, ensureOverlayRoot } from "../Overlay/index.tsx";

/** Wraps a menu's layer. The menu keeps its own anchor maths: x and y are window coordinates and its layer is position fixed. */
export function MenuPortal({ children }: { children: ReactNode }): ReactElement {
  return <Overlay>{children}</Overlay>;
}
