// A chat's own title (owner rule, 4 Nov 2026; lib/chat-name.ts has the whole rule). After a person's first real request in a chat the chat is named for it: 2 to 5 plain words from a cheap model on the
// account that ran the turn (the Space key or the asker's own), or from the request's own words when no model is at hand. Never from a greeting or a test. A title made from a thin request is made again
// once, from the first fuller one. A title a person gave, by renaming from the header or the sidebar, is never replaced: threads.update records it here.
import { TITLE_SYSTEM, directPerson, firstRequest, hasRealTitle, isSmallTalk, isThin, tidyTitle, titleFromRequest } from "../../../lib/chat-name.ts";
import { cheapestModel } from "../../../lib/cheap-model.ts";
import type { ListedModel } from "../../../lib/cheap-model.ts";
import { agentsOf, askerOf, membersOf, raise, threadBy } from "../projections.ts";
import type { ChatCtx, Db } from "../projections.ts";
import { ensureTitleState } from "./title-state.ts";
import { canSpeak } from "./post.ts";
import { touch } from "./g24a.ts";

export type Why = "renamed" | "not_a_chat" | "direct" | "small_talk" | "done" | "has_title";
export interface TitleOut { made: boolean; title?: string; why?: Why }
interface Account { ref: string; driver: string; kind?: string; payer?: string; spaceKey?: boolean }
interface Line { person: boolean; body: string }

const stateOf = (db: Db, thread: string): { source: string; thin: boolean; remade: boolean } | null => {
  const r = db.all('SELECT "source", "thin", "remade" FROM "chat_title_state" WHERE "thread" = ?', thread)[0] as Record<string, unknown> | undefined;
  return r ? { source: String(r["source"]), thin: Number(r["thin"]) === 1, remade: Number(r["remade"]) === 1 } : null;
};

async function linesOf(ctx: ChatCtx, threadId: string): Promise<Line[]> {
  const out = (await ctx.call?.("chat.messages.list", { threadId, limit: 40 })) as { messages?: Array<{ author?: { kind?: string }; body?: string }> } | undefined;
  return (out?.messages ?? []).map((m) => ({ person: m.author?.kind === "person", body: String(m.body ?? "") }));
}

/** 2 to 5 words from the cheapest model the account offers; null when there is no model, no account, or the answer is not a title. */
async function fromModel(ctx: ChatCtx, account: Account | undefined, request: string): Promise<string | null> {
  if (!account?.ref || !account.driver || !ctx.call) return null;
  try {
    let listed: ListedModel[] = [];
    try { listed = ((await ctx.call("engine.models.list", { accountRef: account.ref, probe: false })) as { models?: ListedModel[] }).models ?? []; } catch { listed = []; }
    const model = cheapestModel(account.driver, listed);
    if (!model) return null;
    const out = (await ctx.call("engine.complete", { accountRef: account.ref, model, system: TITLE_SYSTEM, prompt: `The request:\n${request.slice(0, 600)}` })) as { text?: string };
    return tidyTitle(String(out.text ?? ""));
  } catch (e) {
    ctx.log.warn("a chat was not titled by a model", { reason: e instanceof Error ? e.name : "error" });
    return null;
  }
}

export async function titleMake(ctx: ChatCtx, input: { threadId: string; account?: Account | undefined }): Promise<TitleOut> {
  ensureTitleState(ctx.db);
  const t = threadBy(ctx.db, input.threadId);
  if (!t || !canSpeak(ctx, t)) raise(ctx, "validation.not_found", "That chat does not exist or is not yours.");
  if (!askerOf(ctx).startsWith("usr_")) raise(ctx, "permission.no_grant", "A chat is named for the person who asked in it.");
  if (t.kind !== "chat") return { made: false, why: "not_a_chat" };
  const me = askerOf(ctx);
  if (directPerson({ kind: t.kind, agents: agentsOf(ctx.db, t.id).map((a) => a.agentId), people: membersOf(ctx.db, t.id).filter((p) => p.startsWith("usr_") && p !== me) }) !== null) return { made: false, why: "direct" };
  const state = stateOf(ctx.db, t.id);
  if (state?.source === "user") return { made: false, why: "renamed" };
  // a title set by some other route before this rule existed is someone's: leave it
  if (!state && hasRealTitle(t.title)) return { made: false, why: "has_title" };
  if (state && !(state.thin && !state.remade)) return { made: false, why: "done" };
  const lines = await linesOf(ctx, t.id);
  const request = state ? lines.filter((l) => l.person && !isSmallTalk(l.body) && !isThin(l.body))[0]?.body ?? null : firstRequest(lines);
  if (request === null) return { made: false, why: "small_talk" };
  const title = (await fromModel(ctx, input.account, request)) ?? titleFromRequest(request);
  if (title === null) return { made: false, why: "small_talk" };
  // the title might have been changed by a person while the model answered
  const now = stateOf(ctx.db, t.id);
  if (now?.source === "user") return { made: false, why: "renamed" };
  touch(ctx, t.id, "title = ?", title);
  ctx.db.run(
    'INSERT INTO "chat_title_state" ("thread", "source", "thin", "remade", "at") VALUES (?, \'auto\', ?, ?, ?) ON CONFLICT("thread") DO UPDATE SET "source" = \'auto\', "thin" = excluded."thin", "remade" = excluded."remade", "at" = excluded."at"',
    t.id, state ? 0 : isThin(request) ? 1 : 0, state ? 1 : 0, ctx.now(),
  );
  ctx.emit("thread.updated", t.id, { threadId: t.id, fields: ["title"] });
  return { made: true, title };
}
