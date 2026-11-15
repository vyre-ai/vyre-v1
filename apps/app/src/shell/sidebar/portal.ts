// Draws a place's sidebar content into the shell's slot with a React portal (web). One file on purpose: Metro does not apply the .web extension to an import that names
// ".ts", so a separate portal.web.ts was never used and the slot stayed empty. Native has no DOM to portal into and draws nothing here.
import { createPortal } from "react-dom";
import { createElement } from "react";
import { PlaceGate } from "../../../../../ui/src/SidePane/host.tsx";
import type { ReactNode } from "react";
import { Platform } from "react-native";

export function portalInto(target: unknown, node: ReactNode): ReactNode {
  if (Platform.OS !== "web" || target === null || target === undefined) return null;
  return createElement(PlaceGate, null, createPortal(node, target as Element));
}
