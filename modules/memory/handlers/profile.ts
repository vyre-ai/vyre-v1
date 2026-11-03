// The person profile's capabilities (modules/memory/profile.ts says what it is): read it for a chat's audience, the context every turn loads, move a fact between public and private, an agent's
// suggestion to make one public, and adding a fact by hand. Edit, Forget and Erase completely are memory.fact.correct, memory.forget and memory.erase, the same as everywhere else in memory.
import { factAccept, proposeFact } from "./facts.ts";
import { ensureProfile, privateTo, profileAudience, profileFacts, profileOut, setPlace } from "../profile.ts";
import type { Place, ProfileFact } from "../profile.ts";
import { actorOf, loadFact, raise, str } from "../projections.ts";
import type { Fact, MemCtx } from "../projections.ts";

/** Lines of the profile a turn loads, and the most characters a line may have. */
export const PUBLIC_LINES = 15;
export const PRIVATE_LINES = 25;
export const OTHER_LINES = 8;
export const OTHER_PEOPLE = 5;
export const LINE_CHARS = 240;

type Basic = { key: string; label: string; value: string };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function hoursText(v: unknown): string {
  const w = v as { days?: number[]; from?: string; to?: string } | null;
  if (!w || typeof w !== "object" || !w.from || !w.to) return "";
  const days = Array.isArray(w.days) ? w.days.filter((d) => d >= 0 && d <= 6).map((d) => DAYS[d]).join(", ") : "";
  return `${days ? `${days} ` : ""}${w.from} to ${w.to}`;
}

/** What the person set on their own Profile in Settings that is public by nature: title, time zone, working hours. Only the person themselves reads these here. */
async function basicsOf(ctx: MemCtx): Promise<Basic[]> {
  if (ctx.principal.kind !== "person") return [];
  const get = async (key: string): Promise<unknown> => {
    try { return ((await ctx.call("settings.get", { key })) as { row?: { value?: unknown } }).row?.value; } catch { return undefined; }
  };
  const [title, zone, hours] = await Promise.all([get("profile.title"), get("profile.timezone"), get("profile.working_hours")]);
  const out: Basic[] = [];
  if (typeof title === "string" && title.trim() !== "") out.push({ key: "profile.title", label: "Title", value: title.trim() });
  if (typeof zone === "string" && zone.trim() !== "") out.push({ key: "profile.timezone", label: "Time zone", value: zone.trim() });
  const h = hoursText(hours);
  if (h !== "") out.push({ key: "profile.working_hours", label: "Working hours", value: h });
  return out;
}

/** The chat a read answers into: the one named, or the one an agent's tool call came from. Undefined: a person reading their own Settings page. */
const hereOf = (ctx: MemCtx, threadId?: string): string | undefined => threadId ?? (ctx.principal.kind === "agent" ? ctx.thread : undefined);

/** Is the profile read private here? Outside a chat a person reads their own page; an agent outside a chat gets the public part only. */
async function privateHere(ctx: MemCtx, threadId?: string): Promise<boolean> {
  const here = hereOf(ctx, threadId);
  if (here === undefined) return ctx.principal.kind === "person";
  return privateTo(await profileAudience(ctx, here), actorOf(ctx));
}

export async function profileGet(ctx: MemCtx, input: { threadId?: string; personId?: string }) {
  ensureProfile(ctx.db);
  const me = actorOf(ctx);
  const target = input.personId ?? me;
  if (target !== me) {
    // someone else's profile: the public part, which their teammates' chats may hear anyway
    return { audience: "shared" as const, basics: [], public: profileFacts(ctx, target, "public").map(profileOut), private: [] };
  }
  const priv = await privateHere(ctx, input.threadId);
  const all = profileFacts(ctx, me, priv ? "all" : "public");
  return {
    audience: priv ? ("private" as const) : ("shared" as const),
    basics: await basicsOf(ctx),
    public: all.filter((p) => p.place === "public").map(profileOut),
    private: priv ? all.filter((p) => p.place === "private").map(profileOut) : [],
  };
}

const cut = (s: string): string => { const t = s.replace(/\s+/g, " ").trim(); return t.length <= LINE_CHARS ? t : `${t.slice(0, LINE_CHARS - 3)}...`; };
const lineOf = (p: ProfileFact): string => `[${p.fact.id}] ${cut(p.fact.text)}`;

/**
 * The profile part of a turn's context (modules/engine/context.ts), as the person who asked: their public part always, their private part only when nobody else reads the chat, and the public part
 * of the other people in the chat. Lines carry the fact id, so an agent can suggest one for the public profile. Nothing private of anyone else is ever read here.
 */
export async function profileContext(ctx: MemCtx, input: { threadId: string }) {
  ensureProfile(ctx.db);
  const me = actorOf(ctx);
  const a = await profileAudience(ctx, input.threadId);
  const priv = privateTo(a, me);
  const mine = profileFacts(ctx, me, priv ? "all" : "public");
  const people: Array<{ personId: string; self: boolean; basics: string[]; public: string[]; private: string[] }> = [{
    personId: me, self: true,
    basics: (await basicsOf(ctx)).map((b) => `${b.label}: ${b.value}`),
    public: mine.filter((p) => p.place === "public").slice(0, PUBLIC_LINES).map(lineOf),
    private: priv ? mine.filter((p) => p.place === "private").slice(0, PRIVATE_LINES).map(lineOf) : [],
  }];
  for (const other of a.people.filter((p) => p !== me && p.startsWith("usr_")).slice(0, OTHER_PEOPLE)) {
    const pub = profileFacts(ctx, other, "public").slice(0, OTHER_LINES).map(lineOf);
    if (pub.length > 0) people.push({ personId: other, self: false, basics: [], public: pub, private: [] });
  }
  return { audience: priv ? ("private" as const) : ("shared" as const), people };
}

/** A current fact of the caller's own person layer, or a refusal. */
function ownFact(ctx: MemCtx, factId: string): Fact {
  ensureProfile(ctx.db);
  const f = loadFact(ctx, factId);
  if (!f) raise(ctx, "validation.bad_input", "That fact is not there.", { factId });
  if (f.layer !== "person" || f.ownerRef !== actorOf(ctx)) raise(ctx, "permission.no_grant", "Only facts about you can go on your profile, and only you can move them.");
  if (f.status !== "current") raise(ctx, "validation.bad_input", "Only a current fact can move.", { status: f.status });
  // a lesson is what an agent learned about how to work for you: it is never part of what you say about yourself, so it never goes on a profile, public or private
  if (f.kind === "lesson") raise(ctx, "validation.bad_input", "A lesson stays with the agent that learned it. It is not part of your profile.");
  return f;
}

const onlyYou = (ctx: MemCtx): never => raise(ctx, "permission.no_grant", "Only you can put a fact on your public profile. An agent can suggest it with memory_profile_suggest.");

export async function profileMove(ctx: MemCtx, input: { factId: string; to: Place }) {
  const f = ownFact(ctx, input.factId);
  // public is the person's own act: an agent acting for them never moves a fact there, it asks
  if (input.to === "public" && ctx.principal.kind !== "person") onlyYou(ctx);
  setPlace(ctx, f, input.to);
  const after = profileFacts(ctx, f.ownerRef, "all").find((p) => p.fact.id === f.id);
  return { fact: after ? profileOut(after) : { ...profileOut({ fact: f, place: input.to, suggested: false, lineLink: null }) } };
}

/** An agent's "Add to your public profile?": the fact stays private and waits for the person's yes on About you. With text, the fact is remembered (privately) first. */
export async function profileSuggest(ctx: MemCtx, input: { factId?: string; text?: string; threadId?: string }) {
  ensureProfile(ctx.db);
  let factId = input.factId;
  if (!factId) {
    const text = str(input.text).trim();
    if (text === "") raise(ctx, "validation.bad_input", "Name the fact, or give its words.");
    const agentId = ctx.principal.kind === "agent" ? ctx.principal.id : undefined;
    const made = await proposeFact(ctx, { layer: "person", text, kind: "profile", ...(agentId ? { agentId } : {}), sourceKind: input.threadId ? "chat" : "manual", sourceRef: input.threadId ?? "profile", ...(input.threadId ? { threadId: input.threadId } : {}) });
    factId = made.fact.factId;
    if (made.fact.status === "proposed") await factAccept(ctx, { factId });
  }
  const f = ownFact(ctx, factId);
  if (str((ctx.db.all("SELECT profile FROM memory_facts WHERE id = ?", f.id)[0] as { profile?: unknown } | undefined)?.profile) !== "public") setPlace(ctx, f, "suggested");
  const after = profileFacts(ctx, f.ownerRef, "all").find((p) => p.fact.id === f.id)!;
  return { fact: profileOut(after) };
}

/** Add a fact about yourself by hand, to either part. */
export async function profileAdd(ctx: MemCtx, input: { text: string; to: Place; kind?: string }) {
  ensureProfile(ctx.db);
  if (input.to === "public" && ctx.principal.kind !== "person") onlyYou(ctx);
  const made = await proposeFact(ctx, { layer: "person", text: input.text, kind: input.kind ?? "profile", sourceKind: "manual", sourceRef: "profile" });
  if (made.fact.status === "proposed") await factAccept(ctx, { factId: made.fact.factId });
  const f = ownFact(ctx, made.fact.factId);
  if (input.to === "public") setPlace(ctx, f, "public");
  const after = profileFacts(ctx, f.ownerRef, "all").find((p) => p.fact.id === f.id)!;
  return { fact: profileOut(after) };
}
