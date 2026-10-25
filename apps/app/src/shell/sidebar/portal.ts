// Native has no DOM to portal into: the content stays where the place drew it (nothing is drawn). The web file (portal.web.ts) draws it into the slot.
import type { ReactNode } from "react";

export function portalInto(_target: unknown, _node: ReactNode): ReactNode {
  return null;
}
