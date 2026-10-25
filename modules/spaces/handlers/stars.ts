// Stars and follows: independent per-person toggles on anything (spec 2.23). Starring a person or company offers Also follow, on by default.
import type { ResourceRef, SpacesCtx } from "../projections.ts";
import { PERSON_KINDS, listMarks, markOf, me, setMark } from "../projections.ts";

function live(ctx: SpacesCtx, table: "spaces_star" | "spaces_follow", person: string, r: ResourceRef): boolean {
  const m = markOf(ctx, table, person, r);
  return !!m && m.deleted_at === null;
}
function addFollow(ctx: SpacesCtx, person: string, r: ResourceRef): void {
  if (setMark(ctx, "spaces_follow", person, r, true)) ctx.emit("follow.added", r.id, { person, resource: r });
}

export async function starsToggle(ctx: SpacesCtx, input: { resource: ResourceRef; on: boolean; alsoFollow?: boolean }) {
  const person = me(ctx);
  const r = { type: input.resource.type, id: input.resource.id };
  if (setMark(ctx, "spaces_star", person, r, input.on)) ctx.emit(input.on ? "star.added" : "star.removed", r.id, { person, resource: r });
  if (input.on) {
    const kind = ctx.resources?.describe(r)?.kind;
    const offers = kind !== undefined && PERSON_KINDS.has(kind);
    if (input.alsoFollow ?? offers) addFollow(ctx, person, r);
  }
  return { starred: live(ctx, "spaces_star", person, r), following: live(ctx, "spaces_follow", person, r) };
}

export async function starsList(ctx: SpacesCtx, input: { type?: string }) {
  return { stars: listMarks(ctx, "spaces_star", me(ctx), input.type) };
}

export async function followsToggle(ctx: SpacesCtx, input: { resource: ResourceRef; on: boolean }) {
  const person = me(ctx);
  const r = { type: input.resource.type, id: input.resource.id };
  if (setMark(ctx, "spaces_follow", person, r, input.on)) ctx.emit(input.on ? "follow.added" : "follow.removed", r.id, { person, resource: r });
  return { following: live(ctx, "spaces_follow", person, r) };
}

export async function followsList(ctx: SpacesCtx, input: { type?: string }) {
  return { follows: listMarks(ctx, "spaces_follow", me(ctx), input.type) };
}
