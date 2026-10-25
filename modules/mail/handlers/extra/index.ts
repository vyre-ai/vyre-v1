// The mail capabilities no other mail packet owns (P-L5_01c): mailbox admin, message reads, attachment save, health, status updates,
// auto-connect, sending domains and inbound routes. impl.ts merges `extraHandlers` into the module's handler table.
import type { Handler } from "../../../../host/src/invoke.ts";
import { attachmentSave, messageGet, messageList, messageSearch, messageSetPrivate } from "./messages.ts";
import {
  autoConnectMembers, mailboxCreate, mailboxDisconnect, mailboxGet, mailboxList, mailboxPause, mailboxResume, mailboxSetPrivacy, mailboxUpdate,
} from "./mailboxes.ts";
import { domainAdd, domainCheck, domainGet, domainList, domainRemove, domainSetDefault } from "./domains.ts";
import { routeList, routeRemove, routeSet } from "./routes.ts";
import { health, statusUpdate } from "./status.ts";

export const extraHandlers: Record<string, Handler> = {
  "mail.mailbox.list": (ctx, input) => mailboxList(ctx, input),
  "mail.mailbox.get": (ctx, input) => mailboxGet(ctx, input),
  "mail.mailbox.create": (ctx, input) => mailboxCreate(ctx, input),
  "mail.mailbox.update": (ctx, input) => mailboxUpdate(ctx, input),
  "mail.mailbox.set_privacy": (ctx, input) => mailboxSetPrivacy(ctx, input),
  "mail.mailbox.pause": (ctx, input) => mailboxPause(ctx, input),
  "mail.mailbox.resume": (ctx, input) => mailboxResume(ctx, input),
  "mail.mailbox.disconnect": (ctx, input) => mailboxDisconnect(ctx, input),
  "mail.auto_connect_members": (ctx, input) => autoConnectMembers(ctx, input),
  "mail.health": (ctx, input) => health(ctx, input),
  "mail.message.get": (ctx, input) => messageGet(ctx, input),
  "mail.message.list": (ctx, input) => messageList(ctx, input),
  "mail.message.search": (ctx, input) => messageSearch(ctx, input),
  "mail.message.set_private": (ctx, input) => messageSetPrivate(ctx, input),
  "mail.attachment.save": (ctx, input) => attachmentSave(ctx, input),
  "mail.status_update": (ctx, input) => statusUpdate(ctx, input),
  "mail.domain.list": (ctx, input) => domainList(ctx, input),
  "mail.domain.get": (ctx, input) => domainGet(ctx, input),
  "mail.domain.add": (ctx, input) => domainAdd(ctx, input),
  "mail.domain.check": (ctx, input) => domainCheck(ctx, input),
  "mail.domain.set_default": (ctx, input) => domainSetDefault(ctx, input),
  "mail.domain.remove": (ctx, input) => domainRemove(ctx, input),
  "mail.route.list": (ctx, input) => routeList(ctx, input),
  "mail.route.set": (ctx, input) => routeSet(ctx, input),
  "mail.route.remove": (ctx, input) => routeRemove(ctx, input),
};

export { bindDns, setDefaultDns } from "./dns.ts";
export type { DnsLookup } from "./dns.ts";
