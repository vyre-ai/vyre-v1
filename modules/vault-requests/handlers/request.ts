// Vault requests (spec 2.17, ARCH 7.8, 6.11): an agent, skill or automation that needs a key it does not have asks for it by name. The request goes to the managers of the folder it names
// (or the Space's owners and admins) as one Needs you card each; the requester sees its status, and a Run waiting for the key resumes when it is supplied.
// DECISION: a request carries names, never values. A manager supplies the key in the fulfil call; the value goes straight to vault.item.put (or the item they name is shared) and is not stored here,
// not echoed back, not in an event, a card, a log line or the thread. The requester gets Use on the item, which hands out a handle and never the value.
// DECISION: the requester never decides their own request. Anyone who is neither the requester nor a manager gets "not found", so request ids leak nothing. The person an agent asked for (the asker)
// reads it as the requester does: their card in their own chat shows who it waits on (a Team Space agent is shared, so one agent's requests are kept apart by whom it asked for).
// DECISION (owner ruling 3 Nov): an agent's ask for a person that names no folder is that person's own key: they may add it from their card into their own Mine, where only they and an agent working
// for them reach it (no Use is shared). The owners and admins it went to may still add it for the team. A request that names a Shared or team folder, a company key, or a key an outside agent
// asked for by name only goes to the owners and admins alone.
import { agentStanding } from "../../../lib/agent-asker.ts";
import { COMPANY_FOLDER, isCompanyKey } from "../../../lib/company-keys.ts";
import { THROUGH_AGENT, THROUGH_ANYONE } from "../../../lib/through-agent.ts";
import { TABLE, asRow, idsOf, nid, page, raise, requestById, requestOut, strOf } from "../projections.ts";
import type { Ref, RequestRow, State, VaultReqCtx } from "../projections.ts";

const DEFAULT_FIELDS = ["value"];
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Who a call is for as a decider: the signed-in person, or the person an agent acts for. */
function personOf(ctx: VaultReqCtx): string | null {
  if (ctx.principal.kind === "person") return ctx.principal.id;
  return ctx.actingFor ?? null;
}
/**
 * Is this request the caller's own as its requester? The agent that made it counts only in a turn for nobody, or for the person it was made for (lib/agent-asker.ts): another person who merely asks that
 * agent does not see, read or withdraw it.
 */
function ownRequest(ctx: VaultReqCtx, r: RequestRow): boolean {
  const ids = new Set([ctx.principal.id, ...(ctx.actingFor ? [ctx.actingFor] : [])]);
  if (ctx.principal.kind === "agent" && ctx.principal.id === r.requester_id)
    return agentStanding(ctx, (p) => r.asker_id === p || r.requester_id === p);
  return ids.has(r.requester_id) || (!!r.asker_id && ids.has(r.asker_id));
}
const requesterOf = (ctx: VaultReqCtx): Ref => ({ kind: ctx.principal.kind as Ref["kind"], id: ctx.principal.id });

/** The people who may decide a request: those with Manage on the folder, else on the Space (its owners and admins). The requester is never one of them. Asked of the access module's own decider list, so an agent that cannot see the folder still reaches a real person. */
export async function managersFor(
  ctx: VaultReqCtx,
  folderId: string | undefined,
  requester: string,
): Promise<string[]> {
  const ask = async (resource: { type: string; id: string }, why: string): Promise<string[]> => {
    try {
      const got = asRow(await ctx.call("access.deciders", { resource }));
      return (Array.isArray(got?.["people"]) ? (got["people"] as unknown[]) : []).map(String);
    } catch (e) {
      ctx.log.warn(`vault request: ${why} could not be read`, { error: e instanceof Error ? e.message : String(e) });
      return [];
    }
  };
  const out = new Set<string>(
    folderId ? await ask({ type: "vault_folder", id: folderId }, "the folder's managers") : [],
  );
  out.delete(requester);
  // ruling 74: when no folder claims the key, or only the requester manages it, the Space's owners decide
  if (out.size === 0) for (const p of await ask({ type: "space", id: ctx.space }, "the Space managers")) out.add(p);
  out.delete(requester);
  return [...out].sort();
}

/** "Dana_Lawmatics" reads "Dana Lawmatics key needed"; a name that already ends in key is not doubled. */
export function neededTitle(name: string): string {
  const words = name.replace(/_+/g, " ").trim();
  return /\bkey$/i.test(words) ? `${words} needed` : `${words} key needed`;
}

/** The chat the agent asked in and the agent's id, read back from the request's own card (no column holds them). */
async function chatOf(
  ctx: VaultReqCtx,
  row: RequestRow,
): Promise<{ threadId: string; agentId?: string; asker?: string } | null> {
  if (row.thread_id)
    return {
      threadId: row.thread_id,
      ...(row.requester_kind === "agent" ? { agentId: row.requester_id } : {}),
      ...(row.asker_id ? { asker: row.asker_id } : row.requester_kind === "person" ? { asker: row.requester_id } : {}),
    };
  // the caller holds one of the cards, not necessarily the first: another manager's card is not theirs to read
  for (const taskId of idsOf(row.task_ids_json)) {
    try {
      const t = asRow(asRow(await ctx.call("tasks.get", { taskId }))?.["task"]);
      const blocks = Array.isArray(t?.["blocks"]) ? (t!["blocks"] as unknown[]) : [];
      const d = asRow(asRow(blocks[0])?.["data"]);
      const threadId = strOf(d?.["threadId"]);
      return threadId
        ? {
            threadId,
            ...(strOf(d?.["agentId"]) ? { agentId: strOf(d?.["agentId"])! } : {}),
            ...(strOf(d?.["asker"]) ? { asker: strOf(d?.["asker"])! } : {}),
          }
        : null;
    } catch {
      /* the next card */
    }
  }
  return null;
}

/** Where a company key lives: the shared folder Connect your company uses, Restricted before anything goes in, so a Member and every agent can neither list, use nor change it. */
async function companyFolder(ctx: VaultReqCtx): Promise<string | undefined> {
  const name = COMPANY_FOLDER;
  const have = (
    (asRow(await ctx.call("vault.folders.list", { scope: "shared" }))?.["folders"] as
      | { id?: string; name?: string }[]
      | undefined) ?? []
  ).find((f) => f.name === name);
  const id =
    have?.id ??
    strOf(
      asRow(
        asRow(
          await ctx.call("vault.folders.create", {
            name,
            scope: "shared",
            idempotencyKey: `company-folder:${ctx.now()}`,
          }),
        )?.["folder"],
      )?.["id"],
    );
  if (id) await ctx.call("access.labels.set", { resource: { type: "vault_folder", id }, label: "restricted" });
  return id ?? undefined;
}

export async function requestCreate(
  ctx: VaultReqCtx,
  input: {
    name: string;
    fields?: string[];
    reason: string;
    forRun?: string;
    folderId?: string;
    handleOnly?: boolean;
    to?: string;
    idempotencyKey: string;
  },
) {
  const trace = ctx.trace.traceId;
  const requester = requesterOf(ctx);
  const name = input.name.trim();
  if (!NAME.test(name))
    raise(
      trace,
      "validation.bad_input",
      "Name the key like a handle: letters, digits and underscores, starting with a letter.",
    );
  if (!input.reason.trim()) raise(trace, "validation.bad_input", "Say why the key is needed, so a manager can decide.");
  const fields = [
    ...new Set((input.fields && input.fields.length > 0 ? input.fields : DEFAULT_FIELDS).map((f) => f.trim())),
  ];
  for (const f of fields) if (!FIELD.test(f)) raise(trace, "validation.bad_input", `${f} is not a field name.`);

  const asker = requester.kind === "person" ? null : (ctx.actingFor ?? null);
  // one agent's asks for different people are different requests; one it made for nobody in particular serves whoever asks next
  const mine = (ctx.db.all(`SELECT * FROM ${TABLE} WHERE requester_id = ?`, requester.id) as RequestRow[]).filter(
    (r) => (r.asker_id ?? null) === asker || !r.asker_id,
  );
  const again = mine.find((r) => r.idem_key === input.idempotencyKey);
  if (again) return { request: requestOut(again) };
  // asked again while the first ask still waits (another chat, an earlier turn): the same request answers, and its card is drawn in this chat too, so the person types the key where they are now.
  // Both cards read the one request and close together; nobody gets a second task.
  const waiting = mine.find(
    (r) => r.state === "waiting" && r.name === name && r.folder_id === (input.folderId ?? null),
  );
  if (waiting) {
    if ((asker && !waiting.asker_id) || (ctx.thread && ctx.thread !== waiting.thread_id))
      ctx.db.run(
        `UPDATE ${TABLE} SET asker_id = ?, thread_id = ? WHERE id = ?`,
        waiting.asker_id ?? asker,
        ctx.thread ?? waiting.thread_id ?? null,
        waiting.id,
      );
    if (ctx.thread) {
      const fields0 = JSON.parse(waiting.fields_json) as string[];
      const card = {
        type: "vault_request",
        v: 1,
        data: {
          requestId: waiting.id,
          name: waiting.name,
          fields: fields0,
          reason: waiting.reason,
          requester,
          ...(waiting.for_run ? { forRun: waiting.for_run } : {}),
          ...(waiting.folder_id ? { folderId: waiting.folder_id } : {}),
          threadId: ctx.thread,
          ...(requester.kind === "agent" ? { agentId: requester.id } : {}),
          ...((ctx.actingFor ?? (requester.kind === "person" ? requester.id : undefined))
            ? { asker: ctx.actingFor ?? requester.id }
            : {}),
          state: "waiting",
        },
      };
      try {
        await ctx.call("chat.post", {
          threadId: ctx.thread,
          body: "",
          blocks: [card],
          idempotencyKey: `${waiting.id}:card:${ctx.thread}`,
        });
      } catch (e) {
        ctx.log.warn("vault request: the chat card was not posted", {
          requestId: waiting.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      // the tasks' card names the chat the agent carries on in once the key is saved (chatOf): the newest ask's chat, where the person is
      for (const taskId of idsOf(waiting.task_ids_json)) {
        try {
          await ctx.call("tasks.update", { taskId, blocks: [card] });
        } catch (e) {
          ctx.log.warn("vault request: the task card still names the first chat", {
            requestId: waiting.id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
    return { request: requestOut(waiting) };
  }

  // a request addressed to one teammate (an agent asking them in their direct chat) goes to that person alone; they decide it as they would as a manager
  // the person behind this ask (two merged lines named it `asker` twice, which stopped the module loading): a request is never addressed to them
  const self = ctx.actingFor ?? requester.id;
  if (input.to !== undefined && (!input.to.startsWith("usr_") || input.to === self || input.to === requester.id))
    raise(trace, "validation.bad_input", "Address the request to a teammate, not to yourself.");
  const managers = input.to !== undefined ? [input.to] : await managersFor(ctx, input.folderId, requester.id);
  if (managers.length === 0) raise(trace, "validation.precondition_failed", "Nobody can decide this request.");
  const id = nid("vrq");
  const block = {
    type: "vault_request",
    v: 1,
    data: {
      requestId: id,
      name,
      fields,
      reason: input.reason.trim(),
      requester,
      ...(input.forRun ? { forRun: input.forRun } : {}),
      ...(input.folderId ? { folderId: input.folderId } : {}),
      ...(ctx.thread ? { threadId: ctx.thread } : {}),
      ...(ctx.thread && requester.kind === "agent" ? { agentId: requester.id } : {}),
      ...(ctx.thread && (ctx.actingFor ?? (requester.kind === "person" ? requester.id : undefined))
        ? { asker: ctx.actingFor ?? requester.id }
        : {}),
      state: "waiting",
    },
  };
  const taskIds: string[] = [];
  for (const manager of managers) {
    const made = asRow(
      await ctx.call("tasks.create", {
        kind: "unblock",
        title: neededTitle(name),
        summary: input.reason.trim(),
        why: "Add the key to the Vault and it carries on.",
        ...(ctx.thread ? { notes: { thread: ctx.thread } } : {}),
        assigned: { kind: "person", id: manager },
        source: { kind: "manual", id },
        blocks: [block],
        // no "resolved" here: a key request closes only through vault.requests.fulfil (a key saved) or decline, never by pressing a bare Done
        actions: [{ key: "cannot", label: "Deny", note: "optional" }],
        idempotencyKey: `${id}:${manager}`,
      }),
    );
    const taskId = strOf(asRow(made?.["task"])?.["id"]);
    if (!taskId) raise(trace, "internal.unexpected", "The task for the request was not created.");
    taskIds.push(taskId);
  }
  ctx.db.run(
    `INSERT INTO ${TABLE} (id, name, fields_json, reason, requester_kind, requester_id, for_run, folder_id, state, idem_key, managers_json, task_ids_json, at, handle_only, asker_id, thread_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name,
    JSON.stringify(fields),
    input.reason.trim(),
    requester.kind,
    requester.id,
    input.forRun ?? null,
    input.folderId ?? null,
    "waiting",
    input.idempotencyKey,
    JSON.stringify(managers),
    JSON.stringify(taskIds),
    ctx.now(),
    input.handleOnly === true ? 1 : 0,
    asker,
    ctx.thread ?? null,
  );
  const row = requestById(ctx, id)!;
  ctx.emit("vault.requested", id, {
    requestId: id,
    name,
    fields,
    requester,
    ...(input.forRun ? { forRun: input.forRun } : {}),
    taskId: taskIds[0]!,
  });
  // the person asked in a chat: the ask lands there as a card, where they are (Needs you keeps its linked row)
  if (ctx.thread) {
    try {
      await ctx.call("chat.post", { threadId: ctx.thread, body: "", blocks: [block], idempotencyKey: `${id}:card` });
    } catch (e) {
      ctx.log.warn("vault request: the chat card was not posted", {
        requestId: id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { request: requestOut(row) };
}

/** The person an agent asked for may add a key that names no folder into their own Mine (owner ruling 3 Nov). Never a company key, never an outside agent's name-only ask. */
function askerDecides(row: RequestRow, me: string | null): boolean {
  return (
    !!me &&
    row.asker_id === me &&
    row.requester_kind === "agent" &&
    row.handle_only !== 1 &&
    !row.folder_id &&
    !isCompanyKey(`#${row.name}`)
  );
}

/** A request the caller made, or may decide. Anyone else gets "not found". */
function visible(ctx: VaultReqCtx, requestId: string): { row: RequestRow; asRequester: boolean; asManager: boolean } {
  const row = requestById(ctx, requestId);
  const me = personOf(ctx);
  const asRequester = !!row && (ownRequest(ctx, row) || (!!me && row.asker_id === me));
  const asManager = !!row && !!me && row.requester_id !== me && idsOf(row.managers_json).includes(me);
  if (!row || (!asRequester && !asManager)) return raise(ctx.trace.traceId, "validation.not_found", "No such request.");
  return { row, asRequester, asManager };
}

export async function requestsList(
  ctx: VaultReqCtx,
  input: { mine?: boolean; state?: State; cursor?: string; limit?: number },
) {
  const me = personOf(ctx);
  const all = (ctx.db.all(`SELECT * FROM ${TABLE}`) as RequestRow[])
    .filter((r) => {
      const mine = ownRequest(ctx, r);
      const toDecide = (!!me && r.requester_id !== me && idsOf(r.managers_json).includes(me)) || askerDecides(r, me);
      return input.mine === true ? mine : input.mine === false ? toDecide : mine || toDecide;
    })
    .filter((r) => !input.state || r.state === input.state)
    .sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1))
    .map(requestOut);
  const p = page(all, input.cursor, input.limit);
  return { requests: p.rows, total: p.total, ...(p.next ? { next: p.next } : {}) };
}

export async function requestsGet(ctx: VaultReqCtx, input: { requestId: string }) {
  const { row } = visible(ctx, input.requestId);
  // askedYou: the caller is the person the agent asked and may add the key into their own keys, so the card can tell them from a manager answering someone else's ask
  return { request: { ...requestOut(row), ...(askerDecides(row, personOf(ctx)) ? { askedYou: true } : {}) } };
}

/** A card that cannot close is logged; the decision stands. */
async function closeCards(ctx: VaultReqCtx, row: RequestRow, to: "done" | "canceled", note: string): Promise<void> {
  for (const taskId of idsOf(row.task_ids_json)) {
    try {
      await ctx.call("tasks.transition", { taskId, to, note });
    } catch (e) {
      ctx.log.warn("vault request card did not close", {
        requestId: row.id,
        taskId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

/** The agent that asked, when an agent did: an agent outside Vyre has no chat to be told in, so the answer reaches it by its id (modules/mcp). */
const agentOf = (row: RequestRow): { agentId?: string } =>
  row.requester_kind === "agent" ? { agentId: row.requester_id } : {};

/** A manager decides a request that is still waiting, or the person it was asked for adds their own key (`own`: into their Mine). */
function decidable(
  ctx: VaultReqCtx,
  requestId: string,
): { row: RequestRow; me: string; own: boolean; askedForMe: boolean } {
  const { row, asManager } = visible(ctx, requestId);
  const me = personOf(ctx);
  const askedForMe = askerDecides(row, me);
  const own = !asManager && askedForMe;
  if ((!asManager && !own) || !me)
    return raise(ctx.trace.traceId, "permission.no_grant", "Only a manager of this Vault can decide this request.");
  if (row.state !== "waiting") return raise(ctx.trace.traceId, "validation.precondition_failed", "Already decided.");
  return { row, me, own, askedForMe };
}

/**
 * Can whoever asked use a key kept at this folder or item? The real rule, asked of the access module: the effective label (the thing's own and every folder above it) against the requester's
 * clearance. A thing labelled above it is refused to the requester whatever it is shared at, so a key stored there can never be used (the server's own folders are Restricted for that reason).
 * It fails CLOSED: the handler asks with the server's own authority, so the answer is always readable, and a refusal, a not-found or an unreadable answer all refuse the store or the attach (nothing has
 * been stored yet, so nothing is lost by refusing).
 */
async function requesterClears(ctx: VaultReqCtx, row: RequestRow, resource: { type: string; id: string }) {
  try {
    const got = asRow(
      await ctx.call("access.clears", {
        principal: { kind: row.requester_kind, id: row.requester_id },
        target: resource,
      }),
    );
    return got?.["clears"] === true;
  } catch {
    return false;
  }
}

/** Is this folder one of the caller's own Mine folders? A list that cannot be read answers no. */
async function isMineFolder(ctx: VaultReqCtx, folderId: string): Promise<boolean> {
  try {
    const folders =
      (asRow(await ctx.call("vault.folders.list", { scope: "mine" }))?.["folders"] as { id?: string }[] | undefined) ??
      [];
    return folders.some((f) => f.id === folderId);
  } catch {
    return false;
  }
}

/**
 * Is this a shared root folder a service made (the host keeps "Sealed fields" this way: owner svc_host)? The folder row records who made it, so that is the marker, not the name. Such a folder is the
 * server's, even when it is not labelled Restricted (it must not be, or the people who reveal sealed fields could not), so no key for an agent is kept there. A list that cannot be read answers no.
 */
async function serviceMadeFolder(ctx: VaultReqCtx, folderId: string): Promise<boolean> {
  try {
    const folders =
      (asRow(await ctx.call("vault.folders.list", { scope: "shared" }))?.["folders"] as
        | { id?: string; owner?: string; parentId?: string }[]
        | undefined) ?? [];
    return folders.some((f) => f.id === folderId && !f.parentId && String(f.owner ?? "").startsWith("svc_"));
  } catch {
    return false;
  }
}

const RESTRICTED_FOLDER_WORDS =
  "That folder is restricted, so the agent that asked cannot use a key kept there. Choose another folder, or keep the key in your own keys.";
const RESTRICTED_ITEM_WORDS =
  "The agent that asked cannot use that key where it is kept, because the folder is restricted. Move it to your own keys, or choose another key.";
const SERVER_FOLDER_WORDS =
  "That folder is kept by Vyre for its own use, so the agent that asked cannot use a key kept there. Choose another folder, or keep the key in your own keys.";
const SOMEONE_ELSES_MINE_WORDS =
  "That is your own keys, and the agent that asked works for someone else, so it cannot use a key kept there. Choose a shared folder agents can use, or let the person who asked add it.";
const ANYONE_NEEDS_SHARED_WORDS =
  "A key for anyone who asks this agent has to be kept in a shared folder, and this one is in your own keys. Choose a shared folder, or pick Only the person who asked.";

/** The person's own Mine folder for a key they add for themselves: the one they named when it is theirs, else their first, else a new one. */
async function ownMine(ctx: VaultReqCtx, row: RequestRow, named: string | undefined): Promise<string | undefined> {
  const mine = (
    (asRow(await ctx.call("vault.folders.list", { scope: "mine" }))?.["folders"] as { id?: string }[] | undefined) ?? []
  )
    .map((f) => String(f.id ?? ""))
    .filter(Boolean);
  if (named && mine.includes(named)) return named;
  if (mine[0]) return mine[0];
  return strOf(
    asRow(
      asRow(
        await ctx.call("vault.folders.create", { name: "Mine", scope: "mine", idempotencyKey: `${row.id}:mine` }),
      )?.["folder"],
    )?.["id"],
  );
}

/**
 * Who may use a key approved for an agent's request through that agent (owner ruling, 3 Nov 2026): the card asks, "Only the person who asked" (the default) or "Anyone who asks this
 * agent". The agent's Use grant then carries the source the access check reads (kernel THROUGH_AGENT), so that person, or anyone, needs no access of their own to the key.
 */
export type KeyAudience = "asker" | "anyone";
export const throughSource = (audience: KeyAudience, asker: string | undefined): string | null =>
  audience === "anyone" ? `${THROUGH_AGENT}${THROUGH_ANYONE}` : asker ? `${THROUGH_AGENT}${asker}` : null;

export async function requestsFulfil(
  ctx: VaultReqCtx,
  input: {
    requestId: string;
    itemId?: string;
    fields?: { key: string; value: string }[];
    folderId?: string;
    audience?: KeyAudience;
  },
) {
  const trace = ctx.trace.traceId;
  const decided = decidable(ctx, input.requestId);
  const { row, me } = decided;
  // 14 Nov 2026 (owner's own Space): an owner whose Assistant asked them for a key typed it into the card, and because an owner is also a manager the key went to the first shared folder, which was
  // Restricted, where no agent is cleared; the Assistant was refused its own key three times. A new key typed by the person the agent asked for is that person's own, in their Mine, whatever else they
  // are in the Space. It is for the team only when they say so: "anyone who asks this agent", or an item they attach.
  const own = decided.own || (decided.askedForMe && !input.itemId && input.audience !== "anyone");
  const hasFields = !!input.fields && input.fields.length > 0;
  if (!input.itemId === !hasFields)
    raise(trace, "validation.bad_input", "Attach an item, or give the fields for a new one, not both and not neither.");
  const wanted = idsOf(row.fields_json);
  // a company key is kept from every agent on purpose, and a name-only ask gets no Use: neither is a key the requester is to use
  const forAgent = row.handle_only !== 1 && !isCompanyKey(`#${row.name}`);
  let itemId = input.itemId;
  // the item's handle: the agent is told it, because a name another item already holds gets a numbered handle (#Fathom_2), and the name alone would find that other item
  let handle: string | undefined;

  if (itemId) {
    const got = asRow(await ctx.call("vault.item.get", { itemId }));
    const keys = Array.isArray(asRow(got?.["item"])?.["fieldKeys"])
      ? (asRow(got?.["item"])?.["fieldKeys"] as unknown[]).map(String)
      : [];
    const missing = wanted.filter((f) => !keys.includes(f));
    if (missing.length > 0)
      raise(trace, "validation.precondition_failed", `That item has no ${missing.join(", ")} field.`);
    const it = asRow(got?.["item"]);
    handle = strOf(it?.["handle"]);
    if (forAgent) {
      if (!(await requesterClears(ctx, row, { type: "vault_item", id: itemId })))
        raise(trace, "validation.precondition_failed", RESTRICTED_ITEM_WORDS);
      if (!own && input.audience === "anyone" && it?.["scope"] === "mine")
        raise(trace, "validation.precondition_failed", ANYONE_NEEDS_SHARED_WORDS);
      if (!own && !decided.askedForMe && it?.["scope"] === "mine")
        raise(trace, "validation.precondition_failed", SOMEONE_ELSES_MINE_WORDS);
    }
    if (own && (it?.["scope"] !== "mine" || it?.["owner"] !== me))
      raise(
        trace,
        "permission.no_grant",
        "Attach a key from your own Mine. A key for the team is added by an owner or admin.",
      );
  } else {
    const given = new Map((input.fields ?? []).map((f) => [f.key, f.value] as const));
    const missing = wanted.filter((f) => !given.get(f)?.length);
    if (missing.length > 0)
      raise(trace, "validation.precondition_failed", `The key needs a value for ${missing.join(", ")}.`);
    const folderId = own
      ? await ownMine(ctx, row, input.folderId)
      : (input.folderId ?? row.folder_id ?? (isCompanyKey(`#${row.name}`) ? await companyFolder(ctx) : undefined));
    if (!folderId) raise(trace, "validation.precondition_failed", "Choose the folder the new item goes in.");
    // a key someone is to use is only stored where they can use it: refused before anything is stored, whoever asked and whoever is answering
    if (forAgent) {
      if (!(await requesterClears(ctx, row, { type: "vault_folder", id: folderId })))
        raise(trace, "validation.precondition_failed", RESTRICTED_FOLDER_WORDS);
      if (await serviceMadeFolder(ctx, folderId)) raise(trace, "validation.precondition_failed", SERVER_FOLDER_WORDS);
      if (!own && (await isMineFolder(ctx, folderId)))
        raise(
          trace,
          "validation.precondition_failed",
          input.audience === "anyone" || decided.askedForMe ? ANYONE_NEEDS_SHARED_WORDS : SOMEONE_ELSES_MINE_WORDS,
        );
    }
    const made = asRow(
      await ctx
        .call("vault.item.put", {
          folderId,
          name: row.name,
          kind: "api_key",
          fields: (input.fields ?? []).map((f) => ({ key: f.key, value: f.value, secret: true })),
          idempotencyKey: `${row.id}:put`,
        })
        .catch((e: unknown) => {
          // a folder the caller cannot see answers exactly as one that does not exist, and as one the agent cannot use: the same words for all three, so this call is no way to learn that a folder is there
          if ((e as { error?: { code?: string } })?.error?.code === "validation.not_found")
            raise(trace, "validation.precondition_failed", RESTRICTED_FOLDER_WORDS);
          throw e;
        }),
    );
    itemId = strOf(asRow(made?.["item"])?.["id"]);
    handle = strOf(asRow(made?.["item"])?.["handle"]);
    if (!itemId) raise(trace, "internal.unexpected", "The item was not saved.");
  }

  // a company key goes on the card from the person to the Vault, into the Restricted folder, and the agent that asked gets nothing: not Use, not the handle's value. It carries on through the connector, on the server
  if (isCompanyKey(`#${row.name}`))
    await ctx.call("access.labels.set", { resource: { type: "vault_item", id: itemId }, label: "restricted" });
  // a requester that asked for the name only (an outside agent) gets no Use on the item: it passes #NAME as a handle to a call a person approves, and holds nothing afterwards
  else if (row.handle_only === 1) {
    /* no share */
  }
  // the person's own key, in their own Mine: the agent working for them reaches it on their turns, and nobody else's turns do
  else if (own) {
    /* no share */
  } else {
    let shared = true;
    try {
      await ctx.call("vault.share", {
        resource: { type: "vault_item", id: itemId },
        subject: { kind: row.requester_kind, id: row.requester_id },
        level: "use",
        idempotencyKey: `${row.id}:use`,
      });
    } catch (e) {
      // a Mine item is private to its owner: an agent acting for that person already works as them, so there is nothing to share. Any other refusal stands.
      if (!/private/i.test(e instanceof Error ? e.message : "")) throw e;
      // for anyone who asks, "private" is a failure to do what was chosen, never a success
      if (input.audience === "anyone") raise(trace, "validation.precondition_failed", ANYONE_NEEDS_SHARED_WORDS);
      shared = false;
    }
    // who may use it through the agent: the person who asked (default), or anyone who asks this agent
    const source =
      shared && row.requester_kind === "agent"
        ? throughSource(input.audience ?? "asker", (await chatOf(ctx, row))?.asker)
        : null;
    if (source)
      await ctx.call("access.share", {
        resource: { type: "vault_item", id: itemId },
        subject: { kind: "agent", id: row.requester_id },
        level: "use",
        source,
        idempotencyKey: `${row.id}:through`,
      });
  }

  ctx.db.run(
    `UPDATE ${TABLE} SET state = ?, item_id = ?, decided_by = ?, decided_at = ? WHERE id = ?`,
    "fulfilled",
    itemId,
    me,
    ctx.now(),
    row.id,
  );
  const chat = await chatOf(ctx, row);
  // the engine reads the chat, the agent and the asker from this event and tells the agent to carry on there, as the person who asked (the admin who answered may not be in that chat)
  ctx.emit("vault.request_fulfilled", row.id, {
    requestId: row.id,
    itemId,
    ...(handle && /^#[A-Za-z0-9_]+$/.test(handle) ? { handle } : {}),
    name: row.name,
    ...(row.for_run ? { forRun: row.for_run } : {}),
    ...agentOf(row),
    ...(chat
      ? {
          threadId: chat.threadId,
          ...(chat.agentId ? { agentId: chat.agentId } : {}),
          ...(chat.asker ? { asker: chat.asker } : {}),
        }
      : {}),
  });
  // the owners' and admins' rows close from the event (tasks.source_settle); the person it was asked for holds none of them
  if (!own) await closeCards(ctx, row, "done", "Provided");
  if (row.for_run) {
    try {
      await ctx.call("runs.resume", { runId: row.for_run, reason: "key" });
    } catch (e) {
      ctx.log.warn("vault request: the waiting run did not resume", {
        requestId: row.id,
        runId: row.for_run,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { request: requestOut(requestById(ctx, row.id)!) };
}

export async function requestsDecline(ctx: VaultReqCtx, input: { requestId: string; note?: string }) {
  const { row, me, own } = decidable(ctx, input.requestId);
  const note = input.note?.trim() || null;
  ctx.db.run(
    `UPDATE ${TABLE} SET state = ?, note = ?, decided_by = ?, decided_at = ? WHERE id = ?`,
    "declined",
    note,
    me,
    ctx.now(),
    row.id,
  );
  const chat = await chatOf(ctx, row);
  ctx.emit("vault.request_declined", row.id, {
    requestId: row.id,
    name: row.name,
    ...(row.for_run ? { forRun: row.for_run } : {}),
    ...(note ? { note } : {}),
    ...agentOf(row),
    ...(chat
      ? {
          threadId: chat.threadId,
          ...(chat.agentId ? { agentId: chat.agentId } : {}),
          ...(chat.asker ? { asker: chat.asker } : {}),
        }
      : {}),
  });
  if (!own) await closeCards(ctx, row, "canceled", note ? `Declined: ${note}` : "Declined");
  return { ok: true };
}

export async function requestsCancel(ctx: VaultReqCtx, input: { requestId: string }) {
  const { row, asRequester } = visible(ctx, input.requestId);
  if (!asRequester)
    raise(ctx.trace.traceId, "permission.no_grant", "Only the person who asked can withdraw a request.");
  if (row.state !== "waiting")
    raise(ctx.trace.traceId, "validation.precondition_failed", `This request was already ${row.state}.`);
  ctx.db.run(
    `UPDATE ${TABLE} SET state = ?, decided_by = ?, decided_at = ? WHERE id = ?`,
    "canceled",
    ctx.principal.id,
    ctx.now(),
    row.id,
  );
  ctx.emit("vault.request_canceled", row.id, { requestId: row.id });
  await closeCards(ctx, row, "canceled", "Withdrawn");
  return { ok: true };
}
