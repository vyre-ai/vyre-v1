// The notifications module's email, sent through the Space's own mail (the same path portal links take, comms.ts createPortalHost): mail.send from the Space's service mailbox with route
// space_domain, which needs a verified sending domain at Resend or Mailgun. The kinds that email are the Space deletion notices and the approval reminder (modules/notifications rules.ts).
//   to        the person's address: the address their invitation was sent to and accepted (space-ports.ts createMembers().emails(): the only email a Space holds for a person). A person who
//             left or was suspended is not in that list, so is never emailed; a person with no such address (often the owner, who claimed the Space rather than being invited) is "no_address".
//   from      the service mailbox: its title is the sender name and its address the reply address (mail.send viaSpaceDomain). Nothing else goes in: the subject, one line and the link to
//             open in Vyre; never a message body or a Vault value.
//   none      no service mailbox, or no verified sending domain: nothing is sent, the answer is "no_mailbox" (never "sent", never retried), and the health line below says so to admins.
//   health    one line where server health is shown (health_probe `email_notices`): "Email notices are off: this Space has no sending mailbox. People see notices in the app only." with the
//             way to set one up; it goes when a mailbox and a verified domain exist. Console is for admins only, so only someone who can open the place reads it.
// The calls are made as the Space owner with origin "notify", as portal's are made as the owner with origin "portal": an ordinary authorized call, not a bypass.
export type EmailOutcome = "sent" | "no_mailbox" | "no_address" | "suppressed" | "held";

interface InvokeOut { status: string; output?: unknown }
export interface NotifyMailDeps {
  invoke(cap: string, input: unknown, seed: { space: string; principal: { kind: "person"; id: string }; origin: string }): Promise<InvokeOut>;
  space: string;
  owner(): string | null;
  /** active members' addresses (space-ports.ts createMembers) */
  emails(): Promise<Array<{ userId: string; email: string }>>;
  /** write (state "degraded") or clear (null) a server health line */
  health(name: string, line: { detail: string; values?: Record<string, unknown> } | null): void;
  /** a person's display name, for a health line that names them */
  nameOf?(person: string): Promise<string | undefined>;
  warn?(msg: string, attrs?: Record<string, unknown>): void;
}

export const NO_MAILBOX_LINE = "Email notices are off: this Space has no sending mailbox. People see notices in the app only. An admin sets one up in Console, Comms, Sending domains, with a service mailbox.";
export const HEALTH_NAME = "email_notices";

export interface NotifyMailer {
  email(msg: { to: string; subject: string; deepLink: string; key?: string }): Promise<EmailOutcome>;
  /** Is there a sending mailbox? Writes or clears the health line. */
  check(): Promise<boolean>;
  /** An email the notifications module gave up on after its tries: one health line that names the person. */
  gaveUp(msg: { to: string; kind: string }): Promise<void>;
}

const outOf = (r: InvokeOut): Record<string, unknown> | null => (r.status === "ok" && r.output !== null && typeof r.output === "object" ? (r.output as Record<string, unknown>) : null);

export function createNotifyMailer(d: NotifyMailDeps): NotifyMailer {
  const seedOf = (): { space: string; principal: { kind: "person"; id: string }; origin: string } | null => {
    const owner = d.owner();
    return owner ? { space: d.space, principal: { kind: "person", id: owner }, origin: "notify" } : null;
  };
  /** The service mailbox to send from, or null when there is none or no verified sending domain. */
  async function sender(): Promise<string | null> {
    const seed = seedOf();
    if (!seed) return null;
    const boxes = outOf(await d.invoke("mail.mailbox.list", { kind: "service", scope: "all" }, seed).catch(() => ({ status: "error" })));
    const first = (Array.isArray(boxes?.["mailboxes"]) ? (boxes!["mailboxes"] as Array<{ id?: unknown }>) : [])[0];
    if (typeof first?.id !== "string") return null;
    const domains = outOf(await d.invoke("mail.domain.list", {}, seed).catch(() => ({ status: "error" })));
    const verified = (Array.isArray(domains?.["domains"]) ? (domains!["domains"] as Array<{ verified?: unknown }>) : []).some((x) => x.verified === true);
    return verified ? first.id : null;
  }
  async function check(): Promise<boolean> {
    const ok = (await sender()) !== null;
    d.health(HEALTH_NAME, ok ? null : { detail: NO_MAILBOX_LINE });
    return ok;
  }
  return {
    check,
    async email(msg) {
      const mailbox = await sender();
      if (mailbox === null) { d.health(HEALTH_NAME, { detail: NO_MAILBOX_LINE }); return "no_mailbox"; }
      d.health(HEALTH_NAME, null);
      const address = (await d.emails()).find((m) => m.userId === msg.to)?.email;
      if (!address) return "no_address";
      const seed = seedOf()!;
      const text = `${msg.subject}\n\nOpen it in Vyre: ${msg.deepLink}`;
      const r = await d.invoke("mail.send", { mailboxId: mailbox, route: "space_domain", to: [{ address }], subject: msg.subject, text, idempotencyKey: `notify:${msg.to}:${msg.key ?? msg.subject}` }, seed);
      const status = outOf(r)?.["status"];
      if (r.status !== "ok") { if (r.status === "held") return "held"; throw new Error(`the notice email was not sent (${r.status})`); }
      if (status === "queued" || status === "sent") return "sent";
      if (status === "suppressed") return "suppressed";
      if (status === "held") return "held";
      throw new Error(`the notice email was not sent (${String(status)})`);
    },
    async gaveUp(msg) {
      const name = (await d.nameOf?.(msg.to).catch(() => undefined)) ?? "a person";
      const what = msg.kind.startsWith("space.deletion") ? "A notice about deleting this Space" : "A reminder";
      d.health(`email_failed_${msg.to}`.slice(0, 64), { detail: `${what} could not be emailed to ${name}.`, values: { person: msg.to, kind: msg.kind } });
    },
  };
}
