// Handlers for this packet: site end-user accounts, sign-in, record links and row rules.
// portal.file_link and portal.post come from ./extra (P-L8_04b).

import { accountHandlers } from "./accounts.ts";
import { extraHandlers } from "./extra/index.ts";

export const handlers = { ...accountHandlers, ...extraHandlers };

export { redeemFileLink } from "./extra/index.ts";

export { configurePortal, filterRecords, resolveSession, hashPassword, verifyPassword } from "./accounts.ts";
export type { PortalConfig, PortalMailer, LinkMessage, RowRule, PortalRecord, PortalScope, AccountOut } from "./accounts.ts";
