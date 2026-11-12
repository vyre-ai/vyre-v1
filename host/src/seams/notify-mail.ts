// The notifications module's email, sent through the Space's own mail (the same path portal links take, comms.ts createPortalHost): mail.send from the Space's service mailbox with route
// space_domain, which needs a verified sending domain at Resend or Mailgun. The kinds that email are the Space deletion notices and the approval reminder (modules/notifications rules.ts),
// and only Vyre itself files the deletion ones.
//   to        the person's address: the address their invitation was sent to and accepted (space-ports.ts createMembers().emails(): the only email a Space holds for a person), the newest
//             one when there are several. A person who left or was suspended is not in that list, so is never emailed; a person with no such address (often the owner, who claimed the Space
//             rather than being invited) is "no_address".
//   from      a service mailbox whose address is on a verified sending domain: its title is the sender name and its address the reply address (mail.send viaSpaceDomain).
//   what      the module's fixed copy (rules.ts emailCopy): the subject, with the Space's name in front, and one line; then one link the desktop app opens (vyre://open with the Space's address
//             and the place or thing), and the address for a browser. Never a message body, a caller's words or a Vault value.
//   none      no service mailbox on a verified domain: nothing is sent and the answer is "no_mailbox" (never "sent", never retried). The module tells admins once, in Console.
// The calls are made as the Space owner with origin "notify", as portal's are made as the owner with origin "portal": an ordinary authorized call, not a bypass.
export type EmailOutcome = "sent" | "no_mailbox" | "no_address" | "suppressed" | "held";

interface InvokeOut { status: string; output?: unknown }
export interface NotifyMailDeps {
  invoke(cap: string, input: unknown, seed: { space: string; principal: { kind: "person"; id: string }; origin: string }): Promise<InvokeOut>;
  space: string;
  owner(): string | null;
  /** active members' addresses (space-ports.ts createMembers), oldest acceptance first */
  emails(): Promise<Array<{ userId: string; email: string }>>;
  /** the Space's own address (its https origin), or null where it has none the app can reach */
  address(): string | null;
  /** the Space's name, for the subject */
  spaceName(): Promise<string>;
  warn?(msg: string, attrs?: Record<string, unknown>): void;
}
export interface NoticeEmail { to: string; subject: string; line: string; open: { kind: string; id: string }; key?: string }

export interface NotifyMailer {
  email(msg: NoticeEmail): Promise<EmailOutcome>;
  /** An email the notifications module gave up on after its tries: a log line (admins are told in Console by the module). */
  gaveUp(msg: { to: string; kind: string }): Promise<void>;
}

/**
 * The one link in a notice email: vyre://open with the Space's address and the place or thing to open, the shape apps/desktop links.rs takes (action open) and the app's routeDesktopLink
 * opens once signed in, through reach. Null with no address, or a kind or id the router would refuse.
 */
export function noticeLink(address: string | null, open: { kind: string; id: string }): string | null {
  if (!address || !/^[a-z_]{2,24}$/.test(open.kind) || !/^[A-Za-z0-9_.-]{1,128}$/.test(open.id)) return null;
  return `vyre://open?address=${encodeURIComponent(address)}&kind=${open.kind}&id=${open.id}`;
}

const outOf = (r: InvokeOut): Record<string, unknown> | null => (r.status === "ok" && r.output !== null && typeof r.output === "object" ? (r.output as Record<string, unknown>) : null);
const domainOf = (address: unknown): string => (typeof address === "string" && address.includes("@") ? address.slice(address.lastIndexOf("@") + 1).toLowerCase() : "");

export function createNotifyMailer(d: NotifyMailDeps): NotifyMailer {
  const seedOf = (): { space: string; principal: { kind: "person"; id: string }; origin: string } | null => {
    const owner = d.owner();
    return owner ? { space: d.space, principal: { kind: "person", id: owner }, origin: "notify" } : null;
  };
  /** A service mailbox on a verified sending domain, or null when there is none. */
  async function sender(): Promise<string | null> {
    const seed = seedOf();
    if (!seed) return null;
    const boxes = outOf(await d.invoke("mail.mailbox.list", { kind: "service", scope: "all" }, seed).catch(() => ({ status: "error" })));
    const list = Array.isArray(boxes?.["mailboxes"]) ? (boxes!["mailboxes"] as Array<{ id?: unknown; address?: unknown }>) : [];
    if (list.length === 0) return null;
    const domains = outOf(await d.invoke("mail.domain.list", {}, seed).catch(() => ({ status: "error" })));
    const verified = new Set((Array.isArray(domains?.["domains"]) ? (domains!["domains"] as Array<{ name?: unknown; verified?: unknown }>) : []).filter((x) => x.verified === true && typeof x.name === "string").map((x) => String(x.name).toLowerCase()));
    const box = list.find((b) => typeof b.id === "string" && verified.has(domainOf(b.address)));
    return box ? String(box.id) : null;
  }
  return {
    async email(msg) {
      const mailbox = await sender();
      if (mailbox === null) return "no_mailbox";
      const address = (await d.emails()).filter((m) => m.userId === msg.to).pop()?.email;
      if (!address) return "no_address";
      const seed = seedOf()!;
      const space = d.address();
      const link = noticeLink(space, msg.open);
      const text = link ? `${msg.line}\n\nOpen it in the Vyre app: ${link}\nOr go to ${space} in a browser.` : `${msg.line}\n\nOpen Vyre to see it.`;
      const name = (await d.spaceName().catch(() => "")).trim();
      const subject = name ? `${name}: ${msg.subject}` : msg.subject;
      const r = await d.invoke("mail.send", { mailboxId: mailbox, route: "space_domain", to: [{ address }], subject, text, idempotencyKey: `notify:${msg.to}:${msg.key ?? msg.subject}` }, seed);
      const status = outOf(r)?.["status"];
      if (r.status !== "ok") { if (r.status === "held") return "held"; throw new Error(`the notice email was not sent (${r.status})`); }
      if (status === "queued" || status === "sent") return "sent";
      if (status === "suppressed") return "suppressed";
      if (status === "held") return "held";
      throw new Error(`the notice email was not sent (${String(status)})`);
    },
    async gaveUp(msg) {
      d.warn?.("a notice email was given up on after its tries", { person: msg.to, kind: msg.kind });
    },
  };
}
