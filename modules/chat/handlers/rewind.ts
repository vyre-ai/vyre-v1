// chat.rewind (chat gap G36, G37; DESIGN-chat-system item 20): go back in a private chat with an agent to a point the person picked. The engine puts the agent's work folder back and hides what came after from the
// agents (engine.rewind); this leaves the chat's own line: "<name> went back to before ...", with what it did and what it never does. Every message stays in the chat. In a chat with other people each person
// goes back only to their own turn, and the line tells everyone who did it. Only the person themselves, never an agent for them.
import { askerOf, ensure, isMember, membersOf, raise } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { load } from "./g24a.ts";
import { postLinkCard } from "./link-card.ts";

/** What going back leaves alone, in the words the line carries. */
export const LEAVES = "Messages stay. Nothing already sent, no record and no task changes.";

export async function chatRewind(ctx: ChatCtx, input: { threadId: string; pointId: string; idempotencyKey: string }) {
  ensure(ctx.db);
  const t = load(ctx, input.threadId);
  if (ctx.principal.kind !== "person") raise(ctx, "permission.role_lacks_permission", "Only a person goes back.");
  const asker = askerOf(ctx);
  if (t.kind !== "chat" || t.channelId !== undefined)
    raise(ctx, "validation.precondition_failed", "Only a chat with an agent goes back.");
  // a guest is only ever in a channel, so never reaches here. Someone who is in a shared chat but may not post (load() refused them above) cannot go back either.
  if (membersOf(ctx.db, t.id).length > 0 && !isMember(ctx.db, t.id, asker) && t.starter !== asker)
    raise(ctx, "validation.not_found", "That chat does not exist or is not yours.");
  if (!ctx.call) raise(ctx, "internal.unavailable", "Going back is not available just now.");
  // the rule (whose message, whose point, which range, not while the agent works) is the engine's, once: engine.rewind.to. This module leaves the line in the chat afterwards.
  const listed = (await ctx.call("engine.rewind.points", { threadId: t.id })) as {
    points: Array<{ pointId: string; after?: string; during?: boolean }>;
  };
  const point = listed.points.find((p) => p.pointId === input.pointId);
  const done = (await ctx.call("engine.rewind.to", { threadId: t.id, pointId: input.pointId })) as {
    restored: number;
    removed: number;
    failed: number;
    failedPaths: string[];
    undid: boolean;
    during: boolean;
    at: number;
  };
  const files = (n: number): string => (n === 1 ? "1 file" : `${n} files`);
  const did = [
    done.restored > 0 ? `${files(done.restored)} put back` : "",
    done.removed > 0 ? `${files(done.removed)} removed` : "",
  ].filter(Boolean);
  const said =
    (did.length > 0 ? did.join(", ") : "No files changed") +
    (done.failed > 0 ? `. ${done.failed} could not be put back: ${done.failedPaths.join(", ")}` : "");
  const when = done.during || point?.during ? "during" : "before";
  postLinkCard(
    ctx,
    t.id,
    done.undid
      ? {
          icon: "reply",
          lead: "Came back",
          by: asker,
          title: "To where you were before going back",
          sub: `${said}. The agents read the later messages again. ${LEAVES}`,
        }
      : {
          icon: "reply",
          lead: "Went back",
          by: asker,
          title: point?.after ? `To ${when} "${point.after}"` : "To an earlier point",
          sub: `${said}. ${LEAVES}`,
        },
    done.undid
      ? "Came back to where you were"
      : `Went back${point?.after ? ` to ${when} "${point.after}"` : ""}`,
  );
  return {
    restored: done.restored,
    removed: done.removed,
    failed: done.failed,
    failedPaths: done.failedPaths,
    during: done.during,
    at: done.at,
    undid: done.undid,
  };
}
