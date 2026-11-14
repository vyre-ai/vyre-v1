// The connect card (b-connect, 14 Nov 2026; owner: "yes build the connect card, keep Mine"). One tool for an agent, one card for the person, eight states, every one read from the request row and the
// connection, never guessed on the screen. Design: team/v1/DESIGN-connect-card-2026-11-14.md.
// DECISION: nothing is stored until the key works. The typed key is tried against the app first (connectors.check_key); only then is it kept, the connection made and the request closed. A key that
// passes the try but cannot be connected is taken back out of the Vault, so a refusal leaves nothing behind.
// DECISION: the agent is told in one line what to do next and nothing else. The words handle, folder, clearance and role never reach a person from it; the card carries what a person must know.
// DECISION: the same request answers a second ask for the same service (the same card is updated); a card the person folded with Not now is opened again by the next ask.
import { ensureSpaceFolder } from "../../../lib/space-folder.ts";
import { TELL } from "../../../lib/connect-tell.ts";
import type { ConnectStatus as Status } from "../../../lib/connect-tell.ts";
import { keptUsable, madeByService } from "../kept.ts";
import type { FolderRef } from "../kept.ts";
import { TABLE, asRow, nid, raise, requestById, strOf } from "../projections.ts";
import type { RequestRow, VaultReqCtx } from "../projections.ts";
import { decidable, finishFulfil, managersFor, personOf, storeKey, visible } from "./request.ts";
import type { KeyAudience } from "./request.ts";

interface Field {
  name: string;
  label: string;
  optional: boolean;
}
interface Service {
  key: string;
  title: string;
  scope: "person" | "space";
  fields: Field[];
  site?: string;
  host?: string;
  builtin: boolean;
  checks: boolean;
  connection?: { connectionId: string; owner: "mine" | "space"; state: string };
}
export type CardState = "ask" | "have" | "admin" | "asked" | "connected" | "wrong" | "offline" | "later" | "gone";

const SPACE_FOLDER = "Connections";
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
/** A name the Vault accepts for the item: letters, digits and underscores, starting with a letter. */
const itemName = (title: string): string => {
  const n = title
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[A-Za-z]/.test(n) ? n : `Key_${n || "service"}`;
};

async function serviceOf(ctx: VaultReqCtx, said: string): Promise<Service | null> {
  const got = asRow(await ctx.call("connectors.for_service", { service: said }));
  if (!got || got["found"] !== true) return null;
  const c = asRow(got["connector"])!;
  const conn = asRow(got["connection"]);
  return {
    key: String(c["key"]),
    title: String(c["title"]),
    scope: c["scope"] === "space" ? "space" : "person",
    fields: (Array.isArray(c["fields"]) ? (c["fields"] as unknown[]) : []).map((f) => {
      const o = asRow(f)!;
      return { name: String(o["name"]), label: String(o["label"]), optional: o["optional"] === true };
    }),
    ...(strOf(c["site"]) ? { site: strOf(c["site"])! } : {}),
    ...(strOf(c["host"]) ? { host: strOf(c["host"])! } : {}),
    builtin: c["builtin"] === true,
    checks: c["checks"] === true,
    ...(conn
      ? {
          connection: {
            connectionId: String(conn["connectionId"]),
            owner: conn["owner"] === "space" ? ("space" as const) : ("mine" as const),
            state: String(conn["state"]),
          },
        }
      : {}),
  };
}

/** The people who may connect a Space service: the Space's owners and admins (the person asking among them, when they are one). */
const adminsOf = (ctx: VaultReqCtx): Promise<string[]> => managersFor(ctx, undefined, "");

/** The person's own saved key for the service the agent can use: an item named for it, holding every required field. */
async function savedKey(
  ctx: VaultReqCtx,
  row: RequestRow,
  svc: Service,
  folders: Map<string, FolderRef>,
  usable: Map<string, boolean>,
): Promise<{ itemId: string; name: string; keptIn: string } | null> {
  let items: Record<string, unknown>[] = [];
  try {
    items = ((asRow(await ctx.call("vault.items.list", { q: svc.title }))?.["items"] as unknown[] | undefined) ?? [])
      .map((i) => asRow(i))
      .filter((i): i is Record<string, unknown> => !!i);
  } catch {
    return null;
  }
  const need = svc.fields.filter((f) => !f.optional).map((f) => f.name);
  const want = squash(svc.title);
  for (const it of items) {
    const folder = folders.get(String(it["folderId"] ?? ""));
    if (!folder || !squash(String(it["name"] ?? "")).startsWith(want)) continue;
    const keys = Array.isArray(it["fieldKeys"]) ? (it["fieldKeys"] as unknown[]).map(String) : [];
    if (!need.every((k) => keys.includes(k)) || usable.get(folder.id) !== true) continue;
    // only the person's own saved key is offered back to them; a key the team shares is not theirs to attach
    if (folder.scope !== "mine") continue;
    return { itemId: String(it["id"]), name: String(it["name"]), keptIn: "Mine" };
  }
  return null;
}

async function foldersOf(ctx: VaultReqCtx): Promise<Map<string, FolderRef>> {
  const got = asRow(await ctx.call("vault.folders.list", {}));
  const out = new Map<string, FolderRef>();
  for (const f of (Array.isArray(got?.["folders"]) ? (got["folders"] as unknown[]) : []).map((x) => asRow(x))) {
    if (!f) continue;
    out.set(String(f["id"]), {
      id: String(f["id"]),
      name: String(f["name"] ?? ""),
      scope: f["scope"] === "mine" ? "mine" : "shared",
      ...(typeof f["owner"] === "string" ? { owner: f["owner"] } : {}),
      ...(typeof f["parentId"] === "string" ? { parentId: f["parentId"] } : {}),
    });
  }
  return out;
}

/** The card, the whole of it, from the request row and the connection as they are now. */
export async function cardOf(ctx: VaultReqCtx, requestId: string) {
  const { row, asRequester, asManager } = visible(ctx, requestId);
  if (!row.service) raise(ctx.trace.traceId, "validation.not_found", "No such request.");
  const svc = (await serviceOf(ctx, row.service)) ?? {
    key: row.service,
    title: row.service,
    scope: "person" as const,
    fields: [],
    builtin: true,
    checks: false,
  };
  const me = personOf(ctx);
  const askerView = asRequester;
  const admin = asManager && !asRequester;
  let state: CardState;
  let have: { itemId: string; name: string; keptIn: string } | null = null;
  let adminId: string | undefined;
  let mayFill = false;
  let keptIn: string | undefined;
  if (row.state === "canceled") state = "gone";
  else if (row.state === "declined") state = "later";
  else if (row.state === "fulfilled") state = svc.connection?.state === "active" ? "connected" : "later";
  else {
    const phase = row.phase ?? "";
    // who can connect it here: a person's own service needs no permission; a Space service is for the Space's owners and admins
    const admins = svc.scope === "space" ? await adminsOf(ctx) : [];
    const mayConnect = svc.scope === "person" || (!!me && admins.includes(me)) || admin;
    mayFill = (askerView && mayConnect) || admin;
    if (!mayConnect) {
      state = phase === "asked" ? "asked" : "admin";
      adminId = row.admin_id ?? admins.find((a) => a !== me) ?? admins[0];
    } else if (phase === "wrong") state = "wrong";
    else if (phase === "offline") state = "offline";
    else {
      state = "ask";
      if (askerView && svc.scope === "person") {
        const folders = await foldersOf(ctx);
        const usable = await keptUsable(
          ctx,
          row.requester_kind === "agent" ? { kind: "agent", id: row.requester_id } : undefined,
          [...folders.values()],
        );
        have = await savedKey(ctx, row, svc, folders, usable);
        if (have) state = "have";
      }
    }
  }
  if (mayFill && (state === "ask" || state === "wrong" || state === "offline" || state === "have")) {
    // where a typed key goes unless the person chooses: said on the card before they press anything
    const all = await foldersOf(ctx);
    const principal = row.requester_kind === "agent" ? { kind: "agent", id: row.requester_id } : undefined;
    const id = defaultFolder(!admin, [...all.values()], await keptUsable(ctx, principal, [...all.values()]));
    const f = id ? all.get(id) : undefined;
    keptIn = f ? (f.scope === "mine" ? "Mine" : f.name) : admin ? SPACE_FOLDER : "Mine";
  }
  if (state === "connected" && row.item_id) {
    try {
      const it = asRow(asRow(await ctx.call("vault.item.get", { itemId: row.item_id }))?.["item"]);
      keptIn = it?.["scope"] === "mine" ? "Mine" : (await foldersOf(ctx)).get(String(it?.["folderId"] ?? ""))?.name;
    } catch {
      /* the item is gone or not ours to read: the card says it is connected and leaves out where */
    }
  }
  return {
    requestId: row.id,
    state,
    service: { key: svc.key, title: svc.title, ...(svc.site ? { site: svc.site } : {}) },
    fields: svc.fields,
    ...(row.requester_kind === "agent" ? { agentId: row.requester_id } : {}),
    mayFill,
    ...(adminId ? { admin: { id: adminId, ...(row.admin_asked_at ? { askedAt: row.admin_asked_at } : {}) } } : {}),
    ...(have ? { have } : {}),
    ...(keptIn ? { keptIn } : {}),
    ...(row.tested ? { tested: row.tested } : {}),
    checks: svc.checks,
    ...(!svc.builtin && svc.host && mayFill && (state === "ask" || state === "wrong" || state === "offline")
      ? { checksWith: svc.host }
      : {}),
    ...(row.decided_by && row.decided_by !== row.asker_id ? { connectedBy: row.decided_by } : {}),
    ...(row.connection_id ? { connectionId: row.connection_id } : {}),
    usedBy: row.requester_kind === "agent" ? [{ kind: "agent" as const, id: row.requester_id }] : [],
  };
}

/** The card's own acts are a person's, pressed on their own screen: an agent, even one acting for the asker, is refused. */
function personOnly(ctx: VaultReqCtx): void {
  if (ctx.principal.kind !== "person")
    raise(ctx.trace.traceId, "permission.no_grant", "Only a person can do this, from the card.");
}

const connectRows = (ctx: VaultReqCtx, requesterId: string): RequestRow[] =>
  (ctx.db.all(`SELECT * FROM ${TABLE} WHERE requester_id = ?`, requesterId) as RequestRow[]).filter((r) => !!r.service);

/** The card as a block of the chat: the screen reads the request by id, so the block carries only who and what. */
function blockOf(row: RequestRow, ctx: VaultReqCtx, threadId: string) {
  return {
    type: "vault_request",
    v: 1,
    data: {
      requestId: row.id,
      name: row.name,
      fields: JSON.parse(row.fields_json) as string[],
      reason: row.reason,
      requester: { kind: row.requester_kind, id: row.requester_id },
      service: row.service,
      threadId,
      ...(row.requester_kind === "agent" ? { agentId: row.requester_id } : {}),
      ...((row.asker_id ?? ctx.actingFor) ? { asker: row.asker_id ?? ctx.actingFor } : {}),
      state: "waiting",
    },
  };
}

async function drawIn(ctx: VaultReqCtx, row: RequestRow): Promise<void> {
  if (!ctx.thread) return;
  try {
    await ctx.call("chat.post", {
      threadId: ctx.thread,
      body: "",
      blocks: [blockOf(row, ctx, ctx.thread)],
      idempotencyKey: `${row.id}:card:${ctx.thread}`,
    });
  } catch (e) {
    ctx.log.warn("connect card: it was not drawn in the chat", {
      requestId: row.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** The agent's one tool: name the service; the server works out the rest and answers in a line. */
export async function connectService(
  ctx: VaultReqCtx,
  input: { service: string; reason?: string; idempotencyKey: string },
): Promise<{ status: Status; requestId?: string; tell: string }> {
  const trace = ctx.trace.traceId;
  const person = ctx.actingFor ?? (ctx.principal.kind === "person" ? ctx.principal.id : undefined);
  if (!person) raise(trace, "validation.bad_input", "Nobody is asking for this, so there is nobody to connect it for.");
  const said = input.service.trim();
  if (!said) raise(trace, "validation.bad_input", "Say which service.");
  const svc = await serviceOf(ctx, said);
  // no connector, or several of that name: the model is told the one next step, never a guess
  if (!svc) return { status: "no_connector", tell: TELL.no_connector(said) };
  // already connected for this person, and working: nothing to ask
  if (svc.connection?.state === "active") return { status: "connected", tell: TELL.connected(svc.title) };

  const requester = { kind: ctx.principal.kind, id: ctx.principal.id };
  const mine = connectRows(ctx, ctx.principal.id).filter(
    (r) => r.service === svc.key && (r.asker_id ?? null) === (ctx.principal.kind === "person" ? null : person),
  );
  const open = mine.find((r) => r.state === "waiting");
  const folded = mine.filter((r) => r.state === "declined").sort((a, b) => b.at - a.at)[0];
  const again = open ?? folded;
  // a card the person (or an admin) folded stays folded: only the person's own press on the card opens it again
  if (again && again.state === "declined")
    return { status: "declined", requestId: again.id, tell: TELL.declined(svc.title) };
  if (again) {
    if (ctx.thread && ctx.thread !== again.thread_id)
      ctx.db.run(`UPDATE ${TABLE} SET thread_id = ? WHERE id = ?`, ctx.thread, again.id);
    const row = requestById(ctx, again.id)!;
    await drawIn(ctx, row);
    return statusOf(ctx, row, svc);
  }

  const id = nid("vrq");
  const required = svc.fields.filter((f) => !f.optional).map((f) => f.name);
  const reason = input.reason?.trim() || `${svc.title} is needed to answer.`;
  ctx.db.run(
    `INSERT INTO ${TABLE} (id, name, fields_json, reason, requester_kind, requester_id, for_run, folder_id, state, idem_key, managers_json, task_ids_json, at, handle_only, asker_id, thread_id, service) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    itemName(svc.title),
    JSON.stringify(required),
    reason,
    requester.kind,
    requester.id,
    null,
    null,
    "waiting",
    input.idempotencyKey,
    JSON.stringify(svc.scope === "space" ? await adminsOf(ctx) : []),
    JSON.stringify([]),
    ctx.now(),
    0,
    ctx.principal.kind === "person" ? null : person,
    ctx.thread ?? null,
    svc.key,
  );
  const row = requestById(ctx, id)!;
  await drawIn(ctx, row);
  return statusOf(ctx, row, svc);
}

/** What the agent is told, from the request as it stands. */
async function statusOf(
  ctx: VaultReqCtx,
  row: RequestRow,
  svc: Service,
): Promise<{ status: Status; requestId: string; tell: string }> {
  const state = (await cardOf(ctx, row.id)).state;
  const status: Status =
    state === "connected"
      ? "connected"
      : state === "later"
        ? "declined"
        : state === "admin" || state === "asked"
          ? "waiting_admin"
          : "waiting_person";
  return { status, requestId: row.id, tell: TELL[status](svc.title) };
}

export async function connectGet(ctx: VaultReqCtx, input: { requestId: string }) {
  return { card: await cardOf(ctx, input.requestId) };
}

/** Where a key typed on this card goes unless the person chooses: their own Mine when it is theirs to add, else (an admin connecting it for the Space) the first shared folder an agent can use. Reads only: the Mine folder is made when the key is kept. */
function defaultFolder(own: boolean, folders: readonly FolderRef[], usable: Map<string, boolean>): string | undefined {
  if (own) return folders.find((f) => f.scope === "mine")?.id;
  const open = folders
    .filter((f) => f.scope === "shared" && !madeByService(f) && usable.get(f.id) === true)
    .sort((a, b) => a.name.localeCompare(b.name));
  return (open.find((f) => f.name === SPACE_FOLDER) ?? open[0])?.id;
}

/** Where the key can be kept: Mine, the shared folders an agent can use, and those it cannot (shown, not choosable). */
export async function connectOptions(ctx: VaultReqCtx, input: { requestId: string }) {
  const { row, asRequester, asManager } = visible(ctx, input.requestId);
  const folders = [...(await foldersOf(ctx)).values()].filter((f) => !madeByService(f));
  const principal = row.requester_kind === "agent" ? { kind: "agent", id: row.requester_id } : undefined;
  const usable = await keptUsable(ctx, principal, folders);
  const own = asRequester && !(asManager && !asRequester);
  const def = defaultFolder(own, folders, usable);
  return {
    folders: folders
      .map((f) => ({
        id: f.id,
        name: f.scope === "mine" ? "Mine" : f.name,
        scope: f.scope,
        usable: usable.get(f.id) === true,
      }))
      .sort(
        (a, b) =>
          Number(b.usable) - Number(a.usable) ||
          (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === "mine" ? -1 : 1),
      ),
    ...(def ? { default: def } : {}),
  };
}

/** Try the key, connect the service, keep the key. Nothing is kept unless the key works; a refusal at any step leaves the Vault as it was. */
export async function connectSubmit(
  ctx: VaultReqCtx,
  input: {
    requestId: string;
    fields?: { key: string; value: string }[];
    useSaved?: boolean;
    folderId?: string;
    audience?: KeyAudience;
  },
) {
  personOnly(ctx);
  const trace = ctx.trace.traceId;
  const decided = decidable(ctx, input.requestId);
  const { row } = decided;
  if (!row.service) raise(trace, "validation.precondition_failed", "This is not a service to connect.");
  const svc =
    (await serviceOf(ctx, row.service)) ?? raise(trace, "validation.not_found", "That service is no longer set up.");
  const card = await cardOf(ctx, row.id);
  if (!card.mayFill)
    raise(trace, "permission.no_grant", "Only an admin can connect this service here. Ask one from the card.");
  const needed = svc.fields.filter((f) => !f.optional).map((f) => f.name);
  const given = new Map((input.fields ?? []).map((f) => [f.key, f.value.trim()] as const).filter(([, v]) => v !== ""));
  const saved = input.useSaved === true ? card.have : undefined;
  if (input.useSaved === true && !saved)
    raise(trace, "validation.precondition_failed", "There is no saved key to use.");
  if (!saved) {
    const missing = needed.filter((k) => !given.get(k));
    if (missing.length > 0)
      raise(
        trace,
        "validation.bad_input",
        `${missing.map((k) => svc.fields.find((f) => f.name === k)?.label ?? k).join(", ")} is needed.`,
      );
  }
  const done = async (result: "connected" | "wrong" | "offline") => ({ result, card: await cardOf(ctx, row.id) });
  const stay = (phase: "wrong" | "offline" | null) =>
    ctx.db.run(`UPDATE ${TABLE} SET phase = ? WHERE id = ?`, phase, row.id);

  // where the key will be kept is settled first, so a refusal here comes before anything is written: a shared folder only when an agent can use a key kept there
  const chosen = !saved && input.folderId ? (await foldersOf(ctx)).get(input.folderId) : undefined;
  if (chosen?.scope === "shared") {
    const usable = await keptUsable(
      ctx,
      row.requester_kind === "agent" ? { kind: "agent", id: row.requester_id } : undefined,
      [chosen],
    );
    if (usable.get(chosen.id) !== true)
      raise(
        trace,
        "validation.precondition_failed",
        "Agents can't use keys kept there. Keep it in Mine or another folder.",
      );
  }
  // a key typed here goes where the person chose; else Mine for the person it was asked for, and for an admin connecting it for the Space the first shared folder an agent can use
  let folderId = !saved ? input.folderId : undefined;
  if (!saved && !folderId && !decided.askedForMe) {
    const all = [...(await foldersOf(ctx)).values()];
    const principal = row.requester_kind === "agent" ? { kind: "agent", id: row.requester_id } : undefined;
    folderId = defaultFolder(false, all, await keptUsable(ctx, principal, all));
    // the Space's own Connections folder, shared with Everyone at Use, made on first use: a Space service is never kept in one person's Mine
    folderId ??= await ensureSpaceFolder(ctx.call, { name: SPACE_FOLDER, idem: `${row.id}:space-folder` });
  }
  // 1 Checked: the typed key is tried against the app and kept nowhere
  let testedLine: string | null = null;
  if (!saved) {
    const checked = asRow(
      await ctx.call("connectors.check_key", { connector: svc.key, secrets: Object.fromEntries(given) }),
    );
    if (checked?.["result"] === "rejected") {
      stay("wrong");
      return done("wrong");
    }
    if (checked?.["result"] !== "ok") {
      stay("offline");
      return done("offline");
    }
    // "Reached X" only when a call really ran
    if (typeof checked?.["tested"] === "string") testedLine = checked["tested"];
  }

  // 2 keep the key where it goes (a new item, or the saved one attached)
  const stored = await storeKey(
    ctx,
    decided,
    saved
      ? { itemId: saved.itemId }
      : {
          fields: [...given].map(([key, value]) => ({ key, value })),
          ...(folderId ? { folderId } : {}),
          ...(input.audience ? { audience: input.audience } : {}),
          ...(chosen?.scope === "shared" ? { shared: true } : {}),
          attempt: nid("att").slice(4, 12),
        },
  );
  // A key that was kept stays where the person can see it (the card then offers "Use your saved key"): the Vault has no way to erase an item for good, and a quiet move to Trash would leave it recoverable
  // while the card said nothing. A connection made from it, and not working, is removed.
  const takeBack = async (connectionId?: string): Promise<void> => {
    if (connectionId)
      await ctx
        .call("connections.delete", { connectionId, idempotencyKey: `${row.id}:take-back-connection` })
        .catch(() => undefined);
  };

  // 3 Connected: the connection names the item's fields by their handles
  const handle = stored.handle && /^#[A-Za-z0-9_]+$/.test(stored.handle) ? stored.handle : `#${row.name}`;
  const slots: Record<string, string> = {};
  let itemKeys: string[] | null = null;
  if (saved) {
    const it = asRow(asRow(await ctx.call("vault.item.get", { itemId: saved.itemId }))?.["item"]);
    itemKeys = Array.isArray(it?.["fieldKeys"]) ? (it["fieldKeys"] as unknown[]).map(String) : [];
  }
  for (const f of svc.fields)
    if (saved ? itemKeys!.includes(f.name) : given.has(f.name)) slots[f.name] = `${handle}.${f.name}`;
  let connectionId: string | undefined;
  try {
    const made = asRow(
      await ctx.call("connections.create", {
        idempotencyKey: `${row.id}:connect`,
        connector: svc.key,
        title: svc.title,
        ownerKind: svc.scope === "space" ? "space" : "person",
        secrets: slots,
      }),
    );
    connectionId = strOf(asRow(made?.["connection"])?.["connectionId"]);
    if (!connectionId) raise(trace, "internal.unexpected", "The connection was not made.");
    if (saved) {
      const probe = asRow(await ctx.call("connections.test", { connectionId }));
      if (probe?.["state"] === "down") {
        await takeBack(connectionId);
        const why = String(probe["detail"] ?? "")
          .toLowerCase()
          .includes("reject")
          ? "wrong"
          : "offline";
        stay(why);
        return done(why);
      }
    } else await ctx.call("connections.mark_working", { connectionId, idempotencyKey: `${row.id}:working` });
  } catch (e) {
    await takeBack(connectionId);
    throw e;
  }

  // 4 Saved: the request closes, and the agent is told to carry on
  await finishFulfil(ctx, decided, stored, {
    connectionId,
    ...(saved ? (svc.checks ? { tested: "Used your saved key" } : {}) : testedLine ? { tested: testedLine } : {}),
  });
  return done("connected");
}

/** The person may not connect this service: ask an admin, by name. The card then says Asked and finishes by itself when the admin connects it. */
export async function connectAskAdmin(ctx: VaultReqCtx, input: { requestId: string; admin?: string }) {
  personOnly(ctx);
  const trace = ctx.trace.traceId;
  const { row, asRequester } = visible(ctx, input.requestId);
  const me = personOf(ctx);
  if (!row.service || !asRequester || !me)
    raise(trace, "permission.no_grant", "Only the person this was asked for can ask an admin.");
  if (row.state !== "waiting") raise(trace, "validation.precondition_failed", "This card is closed.");
  if (row.phase === "asked") return { card: await cardOf(ctx, row.id) };
  const svc = (await serviceOf(ctx, row.service))!;
  const admins = (await adminsOf(ctx)).filter((a) => a !== me);
  const pick = input.admin && admins.includes(input.admin) ? input.admin : admins[0];
  if (!pick) raise(trace, "validation.precondition_failed", "Nobody can connect this service here.");
  const block = blockOf(row, ctx, row.thread_id ?? "");
  const made = asRow(
    await ctx.call("tasks.create", {
      kind: "unblock",
      title: `Connect ${svc.title}`,
      summary: row.reason,
      why: `Connect ${svc.title} and the Assistant carries on.`,
      ...(row.thread_id ? { notes: { thread: row.thread_id } } : {}),
      assigned: { kind: "person", id: pick },
      source: { kind: "manual", id: row.id },
      blocks: [block],
      actions: [{ key: "cannot", label: "Not now", note: "optional" }],
      idempotencyKey: `${row.id}:${pick}`,
    }),
  );
  const taskId = strOf(asRow(made?.["task"])?.["id"]);
  if (!taskId) raise(trace, "internal.unexpected", "The ask was not sent.");
  ctx.db.run(
    `UPDATE ${TABLE} SET phase = ?, admin_id = ?, admin_asked_at = ?, managers_json = ?, task_ids_json = ? WHERE id = ?`,
    "asked",
    pick,
    ctx.now(),
    JSON.stringify([...new Set([pick, ...admins])]),
    JSON.stringify([taskId]),
    row.id,
  );
  return { card: await cardOf(ctx, row.id) };
}

/** Not now was pressed earlier; the person opens the card again. */
export async function connectReopen(ctx: VaultReqCtx, input: { requestId: string }) {
  personOnly(ctx);
  const trace = ctx.trace.traceId;
  const { row, asRequester } = visible(ctx, input.requestId);
  if (!row.service || !asRequester)
    raise(trace, "permission.no_grant", "Only the person this was asked for can open it again.");
  if (row.state === "waiting") return { card: await cardOf(ctx, row.id) };
  if (row.state !== "declined") raise(trace, "validation.precondition_failed", "This card cannot be opened again.");
  ctx.db.run(`UPDATE ${TABLE} SET state = ?, phase = ?, decided_at = ? WHERE id = ?`, "waiting", null, null, row.id);
  return { card: await cardOf(ctx, row.id) };
}

/** Disconnect: the connection goes, the key stays in the Vault, and the card folds to Not connected. */
export async function connectDisconnect(ctx: VaultReqCtx, input: { requestId: string }) {
  personOnly(ctx);
  const trace = ctx.trace.traceId;
  const { row, asRequester, asManager } = visible(ctx, input.requestId);
  if (!row.service || !(asRequester || asManager))
    raise(trace, "permission.no_grant", "This is not yours to disconnect.");
  if (row.state !== "fulfilled" || !row.connection_id)
    raise(trace, "validation.precondition_failed", "This service is not connected through this card.");
  await ctx.call("connections.delete", {
    connectionId: row.connection_id,
    idempotencyKey: `${row.id}:disconnect:${ctx.now()}`,
  });
  ctx.db.run(
    `UPDATE ${TABLE} SET state = ?, phase = ?, connection_id = ?, tested = ? WHERE id = ?`,
    "declined",
    null,
    null,
    null,
    row.id,
  );
  return { card: await cardOf(ctx, row.id) };
}
