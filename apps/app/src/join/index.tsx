// The join place's screens (generated registry: join.accept, join.sign-in, join.checklist). The shell binds `ui:JoinAccept`, `ui:JoinSignIn` and
// `ui:JoinChecklist` to these by name; anonymous callers reach them at /join/<code> and the sign-in page.
export { AcceptInvite } from "./AcceptInvite.tsx";
export { ConnectAI } from "./ConnectAI.tsx";
export { SignIn } from "./SignIn.tsx";
export { Checklist } from "./Checklist.tsx";
export { JoinFlow, makeRecoveryCode } from "./JoinFlow.tsx";
export type { JoinFlowProps, JoinValues } from "./JoinFlow.tsx";
export type { ChecklistItem, ChecklistKey, ChecklistProps } from "./Checklist.tsx";
export type { JoinInvite, FlowState, Stage } from "./logic.ts";

import { JoinFlow } from "./JoinFlow.tsx";
import { Checklist } from "./Checklist.tsx";

/** KitScreenDef.builtin name to component. */
export const JOIN_SCREENS = { JoinAccept: JoinFlow, JoinSignIn: JoinFlow, JoinChecklist: Checklist } as const;
