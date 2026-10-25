// Web: the place's sidebar content is drawn into the shell's slot with a React portal, so it keeps the place's providers (data, selection, menus) while sitting beside the body.
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

export function portalInto(target: unknown, node: ReactNode): ReactNode {
  return target === null || target === undefined ? null : createPortal(node, target as Element);
}
