// mail.address.*: the Space's addresses as people think of them (owner, 19 Nov 2026: "type billing@ and it exists").
// An address is a name on one of the Space's domains. It is either the address of a mailbox, or an alias: another name that delivers to a mailbox that already exists, so
// billing@ and invoices@ can land in one inbox. mail.address.add makes the name, and the shared inbox behind it when there is none yet, in one step; each half is the same
// code as mail.mailbox.create and mail.route.set and keeps its own idempotency key, so a retry after a half-finished add finishes it and never makes a second inbox or route.
// Who may send as an address is the access module's grant on the mailbox (access.share, the "mailbox" resource): this file does not keep a second list.
// A domain at your own mail server (SMTP) cannot deliver mail here, so an address on it is send-only and is told so.
import { fail } from "../../../host/src/routes/errors.ts";
import { bad, can, first, isId, missing, rowsOf, str, strOrNull } from "../projections.ts";
import type { MailCtx, Row } from "../projections.ts";
import { duplicate, ensureAll, idemRef, liveMailbox, pageOf, parsePage } from "./extra/common.ts";
import type { PageIn } from "./extra/common.ts";
import { mailboxCreate } from "./extra/mailboxes.ts";
import { routeSet } from "./extra/routes.ts";

const PRIVATE_TITLE = "A private inbox";
const seen = (ctx: MailCtx, id: string): boolean => can(ctx, "view", { type: "mailbox", id });

export interface AddressOut {
  address: string;
  domainId: string;
  /** mailbox: the inbox's own address; alias: a route to an inbox with a different name */
  kind: "mailbox" | "alias";
  mailboxId: string;
  mailboxTitle: string;
  routeId?: string;
  /** false on a domain at the person's own mail server: the address can send, mail to it arrives there */
  receives: boolean;
}

const LOCAL = /^[a-z0-9]([a-z0-9._+-]{0,62}[a-z0-9])?$/;

function liveDomains(ctx: MailCtx) {
  return rowsOf(ctx.db.all(`SELECT * FROM mail_domain WHERE deleted_at IS NULL`));
}

/** Every address on the Space's domains: the inbox addresses and the aliases, sorted. */
export async function addressList(
  ctx: MailCtx,
  input: PageIn & { domainId?: string },
): Promise<{ addresses: AddressOut[]; next?: string; total: number }> {
  ensureAll(ctx);
  if (input.domainId !== undefined && !isId("dom", input.domainId)) bad(ctx, "Domain id is not valid.");
  const { offset, limit } = parsePage(ctx, input);
  const domains = liveDomains(ctx).filter((d) => input.domainId === undefined || str(d, "id") === input.domainId);
  const byName = new Map(domains.map((d) => [str(d, "name"), d]));
  const rows: AddressOut[] = [];
  for (const m of rowsOf(ctx.db.all(`SELECT * FROM mail_mailbox WHERE deleted_at IS NULL`))) {
    const address = str(m, "address");
    const dom = byName.get(address.slice(address.lastIndexOf("@") + 1));
    if (!dom) continue;
    rows.push({
      address,
      domainId: str(dom, "id"),
      kind: "mailbox",
      mailboxId: str(m, "id"),
      mailboxTitle: seen(ctx, str(m, "id")) ? str(m, "title") : PRIVATE_TITLE,
      receives: str(dom, "provider") !== "smtp",
    });
  }
  const boxes = new Map(
    rowsOf(ctx.db.all(`SELECT * FROM mail_mailbox WHERE deleted_at IS NULL`)).map((m) => [str(m, "id"), m]),
  );
  for (const r of rowsOf(ctx.db.all(`SELECT * FROM mail_route WHERE deleted_at IS NULL`))) {
    const dom = domains.find((d) => str(d, "id") === str(r, "domainId"));
    const box = boxes.get(str(r, "mailboxId"));
    if (!dom || !box) continue;
    const address = `${str(r, "localPart")}@${str(dom, "name")}`;
    if (address === str(box, "address")) continue; // the inbox's own address is already listed once
    rows.push({
      address,
      domainId: str(dom, "id"),
      kind: "alias",
      mailboxId: str(box, "id"),
      mailboxTitle: seen(ctx, str(box, "id")) ? str(box, "title") : PRIVATE_TITLE,
      routeId: str(r, "id"),
      receives: true,
    });
  }
  rows.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  const page = pageOf(rows, offset, limit);
  const out: { addresses: AddressOut[]; next?: string; total: number } = { addresses: page.items, total: page.total };
  if (page.next) out.next = page.next;
  return out;
}

export interface AddressAddIn {
  domainId: string;
  localPart: string;
  /** deliver to this inbox (an alias); left out, a new inbox is made for the address */
  mailboxId?: string;
  /** the new inbox's name; left out it is the part before the @ */
  title?: string;
  idempotencyKey: string;
}

function domainRow(ctx: MailCtx, domainId: string): Row {
  if (!isId("dom", domainId)) bad(ctx, "Domain id is not valid.");
  const domain = first(ctx.db.all(`SELECT * FROM mail_domain WHERE id = ? AND deleted_at IS NULL`, domainId));
  return domain ?? missing(ctx, "Sending domain does not exist.");
}
function localOf(ctx: MailCtx, value: unknown): string {
  const localPart = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!LOCAL.test(localPart)) bad(ctx, "The name before the @ is letters, digits, dots, plus or dashes.");
  return localPart;
}
/** The inbox a person may send into: one they can use, and never someone else's personal inbox. */
function targetBox(ctx: MailCtx, mailboxId: unknown): Row {
  if (typeof mailboxId !== "string" || !isId("mbx", mailboxId)) bad(ctx, "Mailbox id is not valid.");
  const box = liveMailbox(ctx, mailboxId);
  if (!box) missing(ctx, "Mailbox does not exist.");
  if (
    !can(ctx, "use", { type: "mailbox", id: mailboxId }) ||
    (str(box, "kind") === "personal" && strOrNull(box, "ownerId") !== ctx.principal.id)
  )
    throw fail("permission.no_grant", ctx.trace.traceId);
  return box;
}
/** Who has this name now, in words: its inbox's title (or "a private inbox"), so a refusal says where the mail goes. */
function holder(ctx: MailCtx, domain: Row, localPart: string): { box: Row; route: Row | null } | null {
  const address = `${localPart}@${str(domain, "name")}`;
  const route = first(
    ctx.db.all(
      `SELECT * FROM mail_route WHERE "domainId" = ? AND "localPart" = ? AND deleted_at IS NULL`,
      str(domain, "id"),
      localPart,
    ),
  );
  const routed = route ? liveMailbox(ctx, str(route, "mailboxId")) : null;
  if (routed) return { box: routed, route };
  const own = first(ctx.db.all(`SELECT * FROM mail_mailbox WHERE address = ? AND deleted_at IS NULL`, address));
  return own ? { box: own, route: null } : null;
}
const where = (ctx: MailCtx, box: Row): string =>
  seen(ctx, str(box, "id")) ? str(box, "title") : PRIVATE_TITLE.toLowerCase();

export async function addressAdd(ctx: MailCtx, input: AddressAddIn): Promise<{ address: AddressOut }> {
  ensureAll(ctx);
  const domain = domainRow(ctx, input.domainId);
  const localPart = localOf(ctx, input.localPart);
  const address = `${localPart}@${str(domain, "name")}`;
  const receives = str(domain, "provider") !== "smtp";
  if (!receives && input.mailboxId !== undefined)
    bad(
      ctx,
      "Mail for this domain arrives at your own mail server, so an address on it cannot deliver to an inbox here.",
    );
  const target = input.mailboxId !== undefined ? targetBox(ctx, input.mailboxId) : null;
  // A name that is already taken is never taken over: adding is refused and says where its mail goes. Moving it is mail.address.move.
  const held = holder(ctx, domain, localPart);
  let mailboxId: string;
  let created = false;
  if (held) {
    const unfinished =
      held.route === null &&
      receives &&
      (target === null || str(target, "id") === str(held.box, "id")) &&
      str(held.box, "address") === address;
    const sameKey =
      held.route !== null && idemRef(ctx, `${input.idempotencyKey}:route`, "routeset") === str(held.route, "id");
    if (!unfinished && !sameKey)
      duplicate(
        ctx,
        `${address} already goes to ${where(ctx, held.box)}. Use mail.address.move to point it somewhere else.`,
      );
    mailboxId = str(held.box, "id"); // a retry, or an inbox left behind by an add that stopped half way: finish it
  } else if (target) {
    mailboxId = str(target, "id");
  } else {
    const made = await mailboxCreate(ctx, {
      kind: receives ? "shared" : "service",
      address,
      title: (input.title ?? "").trim() || localPart,
      provider: "inbound_only",
      privacy: "people",
      idempotencyKey: `${input.idempotencyKey}:mailbox`,
    });
    mailboxId = made.mailbox.id;
    created = true;
  }
  let routeId: string | undefined;
  if (receives) {
    try {
      routeId = (
        await routeSet(ctx, {
          domainId: input.domainId,
          localPart,
          mailboxId,
          idempotencyKey: `${input.idempotencyKey}:route`,
        })
      ).route.id;
    } catch (e) {
      // the inbox made a moment ago must not be left behind: with it gone, the same name can be added again with any key
      if (created)
        ctx.db.run(
          `UPDATE mail_mailbox SET deleted_at = ?, updated_at = ? WHERE id = ?`,
          ctx.now(),
          ctx.now(),
          mailboxId,
        );
      throw e;
    }
  }
  return { address: describe(ctx, domain, address, mailboxId, routeId, receives) };
}

function describe(
  ctx: MailCtx,
  domain: Row,
  address: string,
  mailboxId: string,
  routeId: string | undefined,
  receives: boolean,
): AddressOut {
  const box = liveMailbox(ctx, mailboxId);
  const own = box !== null && str(box, "address") === address;
  return {
    address,
    domainId: str(domain, "id"),
    kind: own ? "mailbox" : "alias",
    mailboxId,
    mailboxTitle: box && seen(ctx, mailboxId) ? str(box, "title") : PRIVATE_TITLE,
    ...(routeId && !own ? { routeId } : {}),
    receives,
  };
}

export interface AddressMoveIn {
  domainId: string;
  localPart: string;
  /** the inbox it goes to now; it must be the one the person sees as current, so two people moving one name cannot cross */
  fromMailboxId: string;
  mailboxId: string;
  idempotencyKey: string;
}

/** Point an address that exists at another inbox. It names the old and the new inbox, and the person must be able to use the new one. */
export async function addressMove(
  ctx: MailCtx,
  input: AddressMoveIn,
): Promise<{ address: AddressOut; from: string; to: string }> {
  ensureAll(ctx);
  const domain = domainRow(ctx, input.domainId);
  const localPart = localOf(ctx, input.localPart);
  const address = `${localPart}@${str(domain, "name")}`;
  if (str(domain, "provider") === "smtp")
    bad(
      ctx,
      "Mail for this domain arrives at your own mail server, so an address on it cannot be moved to an inbox here.",
    );
  const route = first(
    ctx.db.all(
      `SELECT * FROM mail_route WHERE "domainId" = ? AND "localPart" = ? AND deleted_at IS NULL`,
      input.domainId,
      localPart,
    ),
  );
  if (!route) missing(ctx, `${address} does not exist. Add it first.`);
  const current = liveMailbox(ctx, str(route, "mailboxId"));
  if (!isId("mbx", input.fromMailboxId)) bad(ctx, "Mailbox id is not valid.");
  const target = targetBox(ctx, input.mailboxId);
  if (str(route, "mailboxId") === str(target, "id"))
    return {
      address: describe(ctx, domain, address, str(target, "id"), str(route, "id"), true),
      from: where(ctx, target),
      to: where(ctx, target),
    };
  if (str(route, "mailboxId") !== input.fromMailboxId)
    duplicate(
      ctx,
      `${address} now goes to ${current ? where(ctx, current) : "another inbox"}, not where you saw it. Look again before moving it.`,
    );
  const out = await routeSet(ctx, {
    domainId: input.domainId,
    localPart,
    mailboxId: str(target, "id"),
    idempotencyKey: input.idempotencyKey,
  });
  return {
    address: describe(ctx, domain, address, str(target, "id"), out.route.id, true),
    from: current ? where(ctx, current) : "another inbox",
    to: where(ctx, target),
  };
}
