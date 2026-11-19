// The daily re-check (owner, 19 Nov 2026): every sending domain's DNS and, for a domain at your own mail server, the server itself, looked at once a day.
// One failed check never stops a domain sending. The second in a row does: the domain stops being verified and stops being the default sender, and the Email page says why. A pass clears the count.
import { first, num, rowsOf, str } from "../projections.ts";
import type { MailCtx } from "../projections.ts";
import { domainCheck } from "./extra/domains.ts";
import { ensureAll } from "./extra/common.ts";
import { smtpVerify } from "./smtp.ts";
import { clearStrikes, strike, STRIKES_TO_STOP } from "./watch.ts";

export interface RecheckOut {
  checked: number;
  failed: number;
  stopped: string[];
}

function whyFailed(ctx: MailCtx, id: string, serverOk: boolean | null): string {
  const d = first(ctx.db.all(`SELECT * FROM mail_domain WHERE id = ?`, id));
  const bad = ["spf", "dkim"].filter((k) => d && str(d, k) !== "pass").map((k) => k.toUpperCase());
  if (serverOk === false) return "The mail server did not answer or did not accept the sign-in.";
  if (bad.length) return `${bad.join(" and ")} no longer ${bad.length > 1 ? "pass" : "passes"} in DNS.`;
  return "The provider no longer reports this domain as verified.";
}

export async function recheckDomains(ctx: MailCtx): Promise<RecheckOut> {
  ensureAll(ctx);
  const out: RecheckOut = { checked: 0, failed: 0, stopped: [] };
  const domains = rowsOf(ctx.db.all(`SELECT * FROM mail_domain WHERE deleted_at IS NULL`)); // a stopped domain is looked at too: when it passes again it is verified again
  let serverOk: boolean | null = null;
  const smtp = domains.some((d) => str(d, "provider") === "smtp");
  // the mail server is tested once for every domain that uses it; the failure is counted per domain below, not twice
  if (smtp) serverOk = (await smtpVerify(ctx, {}, { strike: false }).catch(() => ({ ok: false }))).ok;
  for (const d of domains) {
    const id = str(d, "id");
    // read now, not from the list taken before the loop: a person may have changed the default while an earlier domain was being checked
    const fresh = first(ctx.db.all(`SELECT * FROM mail_domain WHERE id = ?`, id)) ?? d;
    const wasVerified = num(fresh, "verified") === 1;
    const wasDefault = num(fresh, "isDefault") === 1;
    const someoneIsDefault = (): boolean =>
      first(ctx.db.all(`SELECT id FROM mail_domain WHERE "isDefault" = ? AND deleted_at IS NULL`, 1)) !== null;
    out.checked += 1;
    // a check that cannot run is a failed check, not a pass: the row would still read verified
    let threw = false;
    try {
      await domainCheck(ctx, { domainId: id });
    } catch {
      threw = true;
    }
    const now = first(ctx.db.all(`SELECT verified FROM mail_domain WHERE id = ?`, id));
    const serverDown = str(d, "provider") === "smtp" && serverOk === false;
    if (!threw && !serverDown && now && num(now, "verified") === 1) {
      const back = clearStrikes(ctx, id);
      // a domain that was stopped is the default sender again when it passes, unless someone else took the place meanwhile
      if (back.wasStopped && back.wasDefault && !someoneIsDefault())
        ctx.db.run(`UPDATE mail_domain SET "isDefault" = ?, updated_at = ? WHERE id = ?`, 1, ctx.now(), id);
      continue;
    }
    if (!wasVerified) continue; // already stopped: nothing more to count
    out.failed += 1;
    const why = threw
      ? "The check could not be run."
      : whyFailed(ctx, id, str(d, "provider") === "smtp" ? serverOk : null);
    const count = strike(ctx, id, why, { wasDefault });
    if (count >= STRIKES_TO_STOP) {
      out.stopped.push(id);
      ctx.db.run(`UPDATE mail_domain SET verified = ?, "isDefault" = ?, updated_at = ? WHERE id = ?`, 0, 0, ctx.now(), id);
    } else {
      // the first failure is only noted: the domain keeps sending. Put back what the check took away, and the default only if nobody else holds it now
      ctx.db.run(`UPDATE mail_domain SET verified = ?, updated_at = ? WHERE id = ?`, 1, ctx.now(), id);
      if (wasDefault && !someoneIsDefault())
        ctx.db.run(`UPDATE mail_domain SET "isDefault" = ?, updated_at = ? WHERE id = ?`, 1, ctx.now(), id);
    }
  }
  return out;
}
