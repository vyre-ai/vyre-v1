// Inbox > contact tab: the conversation, the composer and the agent drafts.
export { ContactTab, SCREEN as CONTACT_TAB_SCREEN, TabLoading } from "./ContactTab.tsx";
export { followMenuEntries, fromMenuEntries } from "./menus.ts";
export type { ContactTabProps } from "./ContactTab.tsx";
export { discardDraft, markRead, sendAgentDraft, sendEmail, sendText, setFollow } from "./actions.ts";
export * from "./model.ts";
export { Bubbles, CallLine, DaySep, DraftBlock, EmailItem, Player, QuietLine } from "./parts.tsx";
