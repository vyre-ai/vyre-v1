// Inbox > softphone wiring: the shared dock bound to the Inbox's data and the telephony capabilities.
export { InboxPhoneContext, InboxPhoneDock, SOFTPHONE_SCREEN, dockFloats, usePhone } from "./phone.tsx";
export type { ConversationKey, InboxPhone, InboxPhoneProps, PhoneTarget } from "./phone.tsx";
export { callerOf, numbersOf, phoneHooks, prettyNumber, sameNumber, savedLine, suggestionsFor } from "./model.ts";
export type { CallOut, CallsOut, NumbersOut, PhoneIds } from "./model.ts";
export { CallTitlePill } from "./pill.tsx";
