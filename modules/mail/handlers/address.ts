// mail.address.*: the Space's addresses as people think of them (owner, 19 Nov 2026: "type billing@ and it exists").
// An address is a name on one of the Space's domains. It is either the address of a mailbox, or an alias: another name that delivers to a mailbox that already exists, so
// billing@ and invoices@ can land in one inbox. mail.address.add makes the name, and the shared inbox behind it when there is none yet, in one step; each half is the same
// code as mail.mailbox.create and mail.route.set and keeps its own idempotency key, so a retry after a half-finished add finishes it and never makes a second inbox or route.
// Who may send as an address is the access module's grant on the mailbox (access.share, the "mailbox" resource): this file does not keep a second list.
// A domain at your own mail server (SMTP) cannot deliver mail here, so an address on it is send-only and is told so.
import { bad, first, isId, missing, rowsOf, str } from "../projections.ts";
import type { MailCtx } from "../projections.ts";
import { ensureAll, liveMailbox, pageOf, parsePage } from "./extra/common.ts";
import type { PageIn } from "./extra/common.ts";
import { mailboxCreate } from "./extra/mailboxes.ts";
import { routeSet } from "./extra/routes.ts";

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
      mailboxTitle: str(m, "title"),
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
      mailboxTitle: str(box, "title"),
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
  /** deliver to this inbox (an alias); left out, a new shared inbox is made for the address */
  mailboxId?: string;
  /** the new inbox's name; left out it is the part before the @ */
  title?: string;
  idempotencyKey: string;
}

export async function addressAdd(ctx: MailCtx, input: AddressAddIn): Promise<{ address: AddressOut }> {
  ensureAll(ctx);
  if (!isId("dom", input.domainId)) bad(ctx, "Domain id is not valid.");
  const domain = first(ctx.db.all(`SELECT * FROM mail_domain WHERE id = ? AND deleted_at IS NULL`, input.domainId));
  if (!domain) missing(ctx, "Sending domain does not exist.");
  const localPart = typeof input.localPart === "string" ? input.localPart.trim().toLowerCase() : "";
  if (!LOCAL.test(localPart)) bad(ctx, "The name before the @ is letters, digits, dots, plus or dashes.");
  const address = `${localPart}@${str(domain, "name")}`;
  const receives = str(domain, "provider") !== "smtp";
  let mailboxId: string;
  if (input.mailboxId !== undefined) {
    if (!isId("mbx", input.mailboxId)) bad(ctx, "Mailbox id is not valid.");
    if (!liveMailbox(ctx, input.mailboxId)) missing(ctx, "Mailbox does not exist.");
    mailboxId = input.mailboxId;
  } else {
    const made = await mailboxCreate(ctx, {
      kind: "shared",
      address,
      title: (input.title ?? "").trim() || localPart,
      provider: "inbound_only",
      privacy: "space",
      idempotencyKey: `${input.idempotencyKey}:mailbox`,
    });
    mailboxId = made.mailbox.id;
  }
  let routeId: string | undefined;
  if (receives) {
    const set = await routeSet(ctx, {
      domainId: input.domainId,
      localPart,
      mailboxId,
      idempotencyKey: `${input.idempotencyKey}:route`,
    });
    routeId = set.route.id;
  } else if (input.mailboxId !== undefined) {
    bad(
      ctx,
      "Mail for this domain arrives at your own mail server, so an address on it cannot deliver to an inbox here.",
    );
  }
  const box = liveMailbox(ctx, mailboxId);
  const own = box !== null && str(box, "address") === address;
  return {
    address: {
      address,
      domainId: input.domainId,
      kind: own ? "mailbox" : "alias",
      mailboxId,
      mailboxTitle: box ? str(box, "title") : localPart,
      ...(routeId && !own ? { routeId } : {}),
      receives,
    },
  };
}
