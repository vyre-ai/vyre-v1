// mail.route.* (spec 2.18: inbound mail for non-mailbox addresses). A route maps an address on a Space domain to a mailbox. MX points the
// domain at the provider; the provider forwards each inbound message to /hooks/mail (resend.receive_inbound / mailgun.receive_inbound), which
// lands it with mail.ingest, and mail.ingest finds the mailbox through these rows. Mailgun routes also exist at Mailgun, so set creates the
// provider route and remove deletes it; Resend receives per domain and needs no per-address provider object.
import { fail } from "../../../../host/src/routes/errors.ts";
import { bad, first, isId, missing, newId, num, rowsOf, str } from "../../projections.ts";
import type { MailCtx, Row } from "../../projections.ts";
import { oweProviderRouteDelete } from "../cleanup.ts";
import {
  duplicate,
  ensureAll,
  idemRef,
  liveMailbox,
  pageOf,
  parsePage,
  preconditionFailed,
  rememberIdem,
} from "./common.ts";
import type { PageIn } from "./common.ts";

type Provider = "resend" | "mailgun";
const LOCAL = /^(\*|[a-z0-9]([a-z0-9._+-]{0,62}[a-z0-9])?)$/;

export interface RouteOut {
  id: string;
  domainId: string;
  localPart: string;
  mailboxId: string;
  provider: Provider;
}

const routeOut = (row: Row): RouteOut => ({
  id: str(row, "id"),
  domainId: str(row, "domainId"),
  localPart: str(row, "localPart"),
  mailboxId: str(row, "mailboxId"),
  provider: str(row, "provider") === "mailgun" ? "mailgun" : "resend",
});

function domainOf(ctx: MailCtx, id: string): Row {
  if (!isId("dom", id)) bad(ctx, "Domain id is not valid.");
  const row = first(ctx.db.all(`SELECT * FROM mail_domain WHERE id = ? AND deleted_at IS NULL`, id));
  if (!row) missing(ctx, "Sending domain does not exist.");
  return row;
}

const providerOf = (domain: Row): Provider => (str(domain, "provider") === "mailgun" ? "mailgun" : "resend");

export async function routeList(
  ctx: MailCtx,
  input: PageIn & { domainId?: string },
): Promise<{ routes: RouteOut[]; next?: string; total: number }> {
  ensureAll(ctx);
  if (input.domainId !== undefined && !isId("dom", input.domainId)) bad(ctx, "Domain id is not valid.");
  const { offset, limit } = parsePage(ctx, input);
  const rows = input.domainId
    ? rowsOf(ctx.db.all(`SELECT * FROM mail_route WHERE "domainId" = ? AND deleted_at IS NULL`, input.domainId))
    : rowsOf(ctx.db.all(`SELECT * FROM mail_route WHERE deleted_at IS NULL`));
  rows.sort((a, b) => {
    const ka = `${str(a, "domainId")}/${str(a, "localPart")}`;
    const kb = `${str(b, "domainId")}/${str(b, "localPart")}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const page = pageOf(rows, offset, limit);
  const out: { routes: RouteOut[]; next?: string; total: number } = {
    routes: page.items.map(routeOut),
    total: page.total,
  };
  if (page.next) out.next = page.next;
  return out;
}

/** Mailgun's match expression for one address, or every address on the domain for the catch-all. */
export function mailgunExpression(localPart: string, domain: string): string {
  return localPart === "*"
    ? `match_recipient(".*@${domain.replaceAll(".", "\\.")}")`
    : `match_recipient("${localPart}@${domain}")`;
}

export async function routeSet(
  ctx: MailCtx,
  input: {
    domainId: string;
    localPart: string;
    mailboxId: string;
    idempotencyKey: string;
    create?: boolean;
    /** a move: the inbox the caller saw the address going to; if it goes elsewhere now, nothing is changed */
    expectMailboxId?: string;
  },
): Promise<{ route: RouteOut }> {
  ensureAll(ctx);
  const prior = idemRef(ctx, input.idempotencyKey, "routeset");
  if (prior) {
    const row = first(ctx.db.all(`SELECT * FROM mail_route WHERE id = ? AND deleted_at IS NULL`, prior));
    if (row) return { route: routeOut(row) };
  }
  const domain = domainOf(ctx, input.domainId);
  const localPart = typeof input.localPart === "string" ? input.localPart.trim().toLowerCase() : "";
  if (!LOCAL.test(localPart))
    bad(ctx, "The address part must be letters, digits, dots, plus or dashes, or * for the catch-all.");
  if (!isId("mbx", input.mailboxId)) bad(ctx, "Mailbox id is not valid.");
  if (!liveMailbox(ctx, input.mailboxId)) missing(ctx, "Mailbox does not exist.");
  // an SMTP domain's mail arrives at the person's own mail server, not at a provider that can forward it here
  if (str(domain, "provider") === "smtp")
    preconditionFailed(
      ctx,
      "Mail for this domain arrives at your own mail server. Connect that mailbox in Settings, Email and calendar, to bring it into Vyre.",
    );
  const provider = providerOf(domain);
  const existing = first(
    ctx.db.all(
      `SELECT * FROM mail_route WHERE "domainId" = ? AND "localPart" = ? AND deleted_at IS NULL`,
      input.domainId,
      localPart,
    ),
  );
  const now = ctx.now();
  let routeId: string;
  // `create` is an add, never a move: a name that is taken is refused, and nothing is repointed (mail.address.move does that on purpose)
  if (existing && input.create === true)
    duplicate(ctx, `${localPart}@${str(domain, "name")} is already in use. Moving it is a separate step.`);
  if (existing && input.expectMailboxId !== undefined && str(existing, "mailboxId") !== input.expectMailboxId)
    duplicate(
      ctx,
      `${localPart}@${str(domain, "name")} now goes somewhere else, not where you saw it. Look again before moving it.`,
    );
  if (existing) {
    routeId = str(existing, "id");
    if (str(existing, "mailboxId") !== input.mailboxId) {
      // conditional: it changes the route only if it still goes where it went when it was read
      const moved = ctx.db.run(
        `UPDATE mail_route SET "mailboxId" = ?, version = ?, updated_at = ? WHERE id = ? AND "mailboxId" = ?`,
        input.mailboxId,
        num(existing, "version") + 1,
        now,
        routeId,
        str(existing, "mailboxId"),
      );
      if (moved.changes === 0)
        duplicate(
          ctx,
          `${localPart}@${str(domain, "name")} was just changed by someone else. Look again before moving it.`,
        );
    }
  } else {
    let providerRouteId: string | null = null;
    if (provider === "mailgun") {
      const made = (await ctx.call("mailgun.routes.create", {
        idempotencyKey: `${input.idempotencyKey}:mailgun.routes.create`,
        expression: mailgunExpression(localPart, str(domain, "name")),
        description: `Vyre inbound route for ${localPart}@${str(domain, "name")}`,
      })) as { route?: { routeId?: unknown } } | null;
      providerRouteId = typeof made?.route?.routeId === "string" ? made.route.routeId : null;
      if (!providerRouteId)
        throw fail("provider.bad_response", ctx.trace.traceId, { message: "Mailgun did not return the route." });
    }
    routeId = newId("rte", now);
    // The provider call above took time. Look again, then write: the unique index on the live address is the last word, and the loser takes its provider route back and says so.
    // The loser's own Mailgun route must go, or every inbound message for the address would arrive twice: it is deleted now (three tries), and if it still stays it is queued, retried in the background and shown on the Email page.
    const lost = async (): Promise<never> => {
      if (providerRouteId) {
        let removed = false;
        for (let attempt = 0; attempt < 3 && !removed; attempt++) {
          try {
            await ctx.call("mailgun.routes.delete", {
              idempotencyKey: `mail.routes.lost:${routeId}:${attempt}`,
              routeId: providerRouteId,
            });
            removed = true;
          } catch (e) {
            if ((e as { error?: { code?: unknown } } | null)?.error?.code === "validation.not_found") removed = true;
            else if (attempt < 2) await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
          }
        }
        if (!removed)
          oweProviderRouteDelete(
            ctx,
            providerRouteId,
            `${localPart}@${str(domain, "name")}: a Mailgun route made by an add that lost a race could not be deleted yet. It is retried until it is gone.`,
          );
      }
      return duplicate(ctx, `${localPart}@${str(domain, "name")} was just taken by someone else.`);
    };
    if (
      first(
        ctx.db.all(
          `SELECT id FROM mail_route WHERE "domainId" = ? AND "localPart" = ? AND deleted_at IS NULL`,
          input.domainId,
          localPart,
        ),
      )
    )
      return lost();
    try {
      ctx.db.run(
        `INSERT INTO mail_route (id, "domainId", "localPart", "mailboxId", provider, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        routeId,
        input.domainId,
        localPart,
        input.mailboxId,
        provider,
        1,
        now,
        null,
      );
    } catch (e) {
      // only the address index means "taken": any other constraint failure is a real error and is rethrown
      const said = String(e instanceof Error ? e.message : e);
      // the index is named in postgres messages; sqlite names the two columns
      if (
        /unique/i.test(said) &&
        (/mail_route__address/.test(said) || /mail_route\.domainId, mail_route\.localPart/.test(said))
      )
        return lost();
      throw e;
    }
    if (providerRouteId)
      ctx.db.run(
        `INSERT OR IGNORE INTO mail_route_ext ("routeId", "providerRouteId") VALUES (?, ?)`,
        routeId,
        providerRouteId,
      );
  }
  rememberIdem(ctx, input.idempotencyKey, "routeset", routeId);
  ctx.emit("inbound_route.saved", `domain/${input.domainId}`, {
    routeId,
    domainId: input.domainId,
    localPart,
    mailboxId: input.mailboxId,
  });
  const row = first(ctx.db.all(`SELECT * FROM mail_route WHERE id = ?`, routeId));
  if (!row) missing(ctx, "Route does not exist.");
  return { route: routeOut(row) };
}

export async function routeRemove(
  ctx: MailCtx,
  input: { routeId: string; domainId: string },
): Promise<{ removed: boolean }> {
  ensureAll(ctx);
  if (!isId("rte", input.routeId)) bad(ctx, "Route id is not valid.");
  if (!isId("dom", input.domainId)) bad(ctx, "Domain id is not valid.");
  const row = first(ctx.db.all(`SELECT * FROM mail_route WHERE id = ?`, input.routeId));
  if (!row || str(row, "domainId") !== input.domainId) missing(ctx, "Route does not exist on that domain.");
  if (row.deleted_at !== null && row.deleted_at !== undefined) return { removed: true };
  const ext = first(ctx.db.all(`SELECT "providerRouteId" FROM mail_route_ext WHERE "routeId" = ?`, input.routeId));
  const providerRoute = ext ? str(ext, "providerRouteId") : "";
  if (providerRoute) {
    try {
      await ctx.call("mailgun.routes.delete", {
        idempotencyKey: `mail.routes.remove:${input.routeId}`,
        routeId: providerRoute,
      });
    } catch (e) {
      const c = (e as { error?: { code?: unknown } } | null)?.error?.code ?? "";
      if (c !== "validation.not_found") throw e;
    }
  }
  const now = ctx.now();
  ctx.db.run(
    `UPDATE mail_route SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`,
    now,
    num(row, "version") + 1,
    now,
    input.routeId,
  );
  ctx.emit("inbound_route.removed", `domain/${input.domainId}`, { routeId: input.routeId, domainId: input.domainId });
  return { removed: true };
}
