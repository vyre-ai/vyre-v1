// Home sections B: the first-run checklist (top), then Today, Starred and the Ask box (bottom), plus the Personal Space variant. Plugged into Home through its `top` and `bottom` slots.
import { createElement } from "react";
import type { ReactNode } from "react";
import { AskBox } from "./AskBox.tsx";
import { Checklist } from "./Checklist.tsx";
import { HomeBProvider } from "./data.tsx";
import type { HomeBExtras } from "./data.tsx";
import { Starred } from "./Starred.tsx";
import { Today } from "./Today.tsx";

export { AskBox } from "./AskBox.tsx";
export { Checklist } from "./Checklist.tsx";
export { Starred, STARRED_SECTION } from "./Starred.tsx";
export { Today, TODAY_SECTION } from "./Today.tsx";
export { HomeBProvider, isPersonal, useExtras } from "./data.tsx";
export type { GoTarget, HomeBExtras } from "./data.tsx";
export * from "./model.ts";
export * from "./actions.ts";

/** The two slots Home takes: `top` above Needs you, `bottom` below the routines. */
export function homeBSlots(extras: HomeBExtras): { top: ReactNode; bottom: ReactNode } {
  return {
    top: createElement(HomeBProvider, { value: extras }, createElement(Checklist)),
    bottom: createElement(HomeBProvider, { value: extras }, createElement(Today), createElement(Starred), createElement(AskBox)),
  };
}
