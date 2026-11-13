// inbox module entry (lane L5). The host serves the generated stubs while manifests/inbox.ts says `status: 'stub'`; the flip to live is a one-line edit to host/modules.json
// (ruling 25) once P-CI_02 has landed. The module keeps conversations, follows and an index of the messages, texts and calls each holds; the messages stay in mail,
// telephony and meetings. mail.ingest, telephony and meetings call inbox.link_message for every stored item.
import type { Handler } from "../../host/src/invoke.ts";
import { backfill } from "./backfill.ts";
import * as h from "./handlers/index.ts";
import { finished, seamFor, stateKinds } from "./state.ts";
import type { InboxCtx } from "./projections.ts";
import { matchClosingTask, matchNewClosingTask, recipientsSearchWithMembers } from "./handlers/recipients-members.ts";

/** A capability on one conversation: the access rules know no row for a conversation (an unmatched sender has no record above it), so the manifest binds these to the Space and the Inbox's own rule decides who may touch it. */
const guarded =
  (run: Handler): Handler =>
  async (ctx, input) => {
    await h.guardConversation(ctx as never, (input as { conversationId?: unknown } | undefined)?.conversationId);
    return run(ctx, input);
  };

export const handlers: Record<string, Handler> = {
  "inbox.list_by_contact": (ctx, i) => h.listByContact(ctx, i),
  "inbox.list_by_thread": (ctx, i) => h.listByThread(ctx, i),
  "inbox.thread": (ctx, i) => h.thread(ctx, i),
  "inbox.threads": (ctx, i) => h.threads(ctx, i),
  "inbox.thread_conversation": (ctx, i) => h.threadConversation(ctx, i),
  "inbox.unmatched": (ctx, i) => h.unmatched(ctx, i),
  "inbox.needs_match": (ctx, i) => h.needsMatch(ctx, i),
  "inbox.match_suggestions": guarded((ctx, i) => h.matchSuggestions(ctx, i)),
  "inbox.match": guarded((ctx, i) => matchClosingTask(ctx, i)),
  "inbox.unmatch": guarded((ctx, i) => h.unmatch(ctx, i)),
  "inbox.match_new": guarded((ctx, i) => matchNewClosingTask(ctx, i)),
  "inbox.link_message": (ctx, i) => h.linkMessage(ctx, i),
  "inbox.counts": (ctx) => h.counts(ctx),
  "inbox.mark_read": guarded((ctx, i) => h.markRead(ctx, i)),
  "inbox.follow_set": (ctx, i) => h.followSet(ctx, i),
  "inbox.following": (ctx, i) => h.following(ctx, i),
  "inbox.send_options": (ctx, i) => h.sendOptions(ctx, i),
  "inbox.recipients_search": (ctx, i) => recipientsSearchWithMembers(ctx, i),
  "inbox.item.erase": (ctx, i) => h.itemErase(ctx, i),
  "comms.senders.list": (ctx, i) => h.sendersList(ctx, i),
  "comms.senders.set_default": (ctx, i) => h.sendersSetDefault(ctx, i),
};

export const projections = { inline: {}, consumers: {} };

/** What `state` needs to know about an Inbox conversation (host/src/seams/state.ts): the host registers it at boot. */
export { stateKinds };

/**
 * When the server starts, and every five minutes until it has worked: give every item an arrival number and every person who can see a conversation their own place in it, from what the shared read
 * flag said (backfill.ts). It reads and logs what it is about to do first, writes once, and does nothing on a Space it has already finished. If the Space's list of people cannot be read, it has NOT run:
 * nothing is written, nothing is marked done, a plain line is logged, and the next run tries again (a zero for everyone is never the answer).
 */
export const periodic = {
  "inbox.state_backfill": {
    everyMs: 5 * 60_000,
    immediate: true,
    run: async (ctx: InboxCtx): Promise<void> => {
      if (finished(ctx)) return;
      const plan = await backfill(ctx, { dryRun: true });
      if (plan.deferred !== undefined) {
        ctx.log.warn(`inbox: per-person state has not started: ${plan.deferred}. It will try again in a few minutes.`);
        return;
      }
      if (plan.conversations > 0) ctx.log.info("inbox: per-person state, the plan", { ...plan });
      const done = await backfill(ctx, { dryRun: false });
      if (done.deferred !== undefined) {
        ctx.log.warn(`inbox: per-person state has not started: ${done.deferred}. It will try again in a few minutes.`);
        return;
      }
      if (!done.alreadyDone)
        ctx.log.info("inbox: per-person state, done", { rowsMade: done.rowsMade, numbered: done.numbered });
    },
  },
};

/** The host's way to ask for the backfill by hand: `{ dryRun: true }` reports and writes nothing. */
export const hostCalls = {
  "inbox.state_backfill": (ctx: InboxCtx, input: { dryRun?: boolean }) =>
    backfill(ctx, { dryRun: input?.dryRun !== false }),
};

/**
 * Who can open a conversation changes when a grant, a role, a group, a mailbox's privacy, a follow or an owner changes. The people whose row of a conversation no longer fits leave it (it drops out of
 * their lists and badge at once), and the people who can open it again come back with nothing unread. A badge that counts what a person can no longer open would tell them it exists.
 */
export const consumers = {
  "inbox.state_access": {
    on: [
      "grant.created",
      "grant.updated",
      "grant.revoked",
      "access.changed",
      "mailbox.privacy_changed",
      "conversation.follow_changed",
      "conversation.matched",
      "conversation.unmatched",
    ],
    run: async (ctx: InboxCtx, event?: { name?: string; payload?: Record<string, unknown> }): Promise<void> => {
      const store = await seamFor(ctx);
      const p = event?.payload ?? {};
      const subject = p["subject"] as { kind?: string; id?: string } | undefined;
      // what the event names decides how much is asked: one person's grant, one person's follow, one conversation; anything wider (a role, a group, a mailbox's privacy) asks about every row
      if ((event?.name ?? "").startsWith("grant.") && subject?.kind === "person" && typeof subject.id === "string")
        store.reconcile("conversation", { person: subject.id });
      else if (event?.name === "conversation.follow_changed" && typeof p["principalId"] === "string")
        store.reconcile("conversation", { person: p["principalId"] });
      else if (
        (event?.name === "conversation.matched" || event?.name === "conversation.unmatched") &&
        typeof p["conversationId"] === "string"
      )
        store.reconcile("conversation", { things: [p["conversationId"]] });
      else store.reconcile("conversation");
    },
  },
};
