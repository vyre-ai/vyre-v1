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
    const wasDefault = num(d, "isDefault");
    const wasVerified = num(d, "verified") === 1;
    out.checked += 1;
    try {
      await domainCheck(ctx, { domainId: id });
    } catch {
      /* a check that could not run counts as a failed one below if the domain no longer reads as verified */
    }
    const now = first(ctx.db.all(`SELECT verified FROM mail_domain WHERE id = ?`, id));
    if (now && num(now, "verified") === 1) {
      clearStrikes(ctx, id);
      continue;
    }
    if (!wasVerified) continue; // already stopped: nothing more to count
    out.failed += 1;
    const why = whyFailed(ctx, id, str(d, "provider") === "smtp" ? serverOk : null);
    const count = strike(ctx, id, why);
    if (count >= STRIKES_TO_STOP)
      out.stopped.push(id); // the first failure is only noted: the domain keeps sending, and keeps being the default if it was
    else
      ctx.db.run(
        `UPDATE mail_domain SET verified = ?, "isDefault" = ?, updated_at = ? WHERE id = ?`,
        1,
        wasDefault,
        ctx.now(),
        id,
      );
  }
  return out;
}
