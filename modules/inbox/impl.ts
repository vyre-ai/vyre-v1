// inbox module entry (lane L5). The host serves the generated stubs while manifests/inbox.ts says `status: 'stub'`; the flip to live is a one-line edit to host/modules.json
// (ruling 25) once P-CI_02 has landed. The module keeps conversations, follows and an index of the messages, texts and calls each holds; the messages stay in mail,
// telephony and meetings. mail.ingest, telephony and meetings call inbox.link_message for every stored item.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";

export const handlers: Record<string, Handler> = {
  "inbox.list_by_contact": (ctx, i) => h.listByContact(ctx, i),
  "inbox.list_by_thread": (ctx, i) => h.listByThread(ctx, i),
  "inbox.thread": (ctx, i) => h.thread(ctx, i),
  "inbox.unmatched": (ctx, i) => h.unmatched(ctx, i),
  "inbox.needs_match": (ctx, i) => h.needsMatch(ctx, i),
  "inbox.match_suggestions": (ctx, i) => h.matchSuggestions(ctx, i),
  "inbox.match": (ctx, i) => h.match(ctx, i),
  "inbox.unmatch": (ctx, i) => h.unmatch(ctx, i),
  "inbox.match_new": (ctx, i) => h.matchNew(ctx, i),
  "inbox.link_message": (ctx, i) => h.linkMessage(ctx, i),
  "inbox.counts": (ctx) => h.counts(ctx),
  "inbox.mark_read": (ctx, i) => h.markRead(ctx, i),
  "inbox.follow_set": (ctx, i) => h.followSet(ctx, i),
  "inbox.following": (ctx, i) => h.following(ctx, i),
  "inbox.send_options": (ctx, i) => h.sendOptions(ctx, i),
  "inbox.recipients_search": (ctx, i) => h.recipientsSearch(ctx, i),
  "inbox.item.erase": (ctx, i) => h.itemErase(ctx, i),
};

export const projections = { inline: {}, consumers: {} };
