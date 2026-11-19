// mail.setup.status: the Space's email setup in one read, for the Email page and for agents and MCP (owner, 19 Nov 2026: one place for provider, domain, DNS and a test).
// It answers three questions in plain words: which way does this Space send, what is still missing, and what is the next step.
// It reads only: the provider setting, the saved mail server (SMTP), and the sending domains with their DNS state.
import { createHash } from "node:crypto";
import { ensureAll, preconditionFailed } from "./extra/common.ts";
import { domainList } from "./extra/domains.ts";
import type { DomainOut } from "./extra/domains.ts";
import { smtpGet } from "./smtp.ts";
import { allWatches } from "./watch.ts";
import type { Watch } from "./watch.ts";
import { openCleanups } from "./cleanup.ts";
import type { CleanupOut } from "./cleanup.ts";
import type { SmtpOut } from "./smtp.ts";
import { bad, can, first, rowsOf, str } from "../projections.ts";
import type { MailCtx } from "../projections.ts";

export type SetupProvider = "resend" | "mailgun" | "smtp";
export type SetupStep = "choose_provider" | "connect_server" | "add_domain" | "publish_dns" | "set_default" | "ready";

export interface SetupOut {
  provider: SetupProvider;
  smtp: SmtpOut;
  domains: DomainOut[];
  /** domains whose last daily check failed: how many times in a row and why; the second stops the domain */
  rechecks: Watch[];
  /** work the module still owes (a provider route being deleted) and notes about routes it removed; shown until done or two weeks */
  cleanups: CleanupOut[];
  /** every step that is done, in order, so the page can tick them */
  done: SetupStep[];
  step: SetupStep;
  /** the next thing to do, one sentence */
  next: string;
  ready: boolean;
}

const PROVIDERS = new Set<string>(["resend", "mailgun", "smtp"]);

async function providerOf(ctx: MailCtx): Promise<SetupProvider> {
  try {
    const row = ((await ctx.call("settings.get", { key: "mail.provider" })) as { row?: { value?: unknown } } | null)
      ?.row;
    const v = row?.value;
    return typeof v === "string" && PROVIDERS.has(v) ? (v as SetupProvider) : "resend";
  } catch {
    return "resend"; // the manifest default stands when the settings service gives nothing
  }
}

/** The pure part: given what exists, which steps are done and what comes next. Tested on its own. */
export function planSetup(
  provider: SetupProvider,
  smtp: SmtpOut,
  domains: DomainOut[],
): Pick<SetupOut, "done" | "step" | "next" | "ready"> {
  const done: SetupStep[] = ["choose_provider"];
  const mine = domains.filter((d) => d.provider === provider);
  const verified = mine.filter((d) => d.verified);
  const blocked = (step: SetupStep, next: string) => ({ done, step, next, ready: false });
  if (provider === "smtp") {
    if (!smtp.configured)
      return blocked(
        "connect_server",
        "Enter your mail server, its port and username, and keep the password in the Vault.",
      );
    if (smtp.state === "failed")
      return blocked(
        "connect_server",
        smtp.detail
          ? `The mail server test failed: ${smtp.detail}`
          : "The mail server test failed. Check the server details and test again.",
      );
    if (smtp.state !== "ok") return blocked("connect_server", "Test the mail server. Nothing is sent by the test.");
    done.push("connect_server");
  }
  if (mine.length === 0) return blocked("add_domain", "Add the domain your email comes from.");
  done.push("add_domain");
  if (verified.length === 0)
    return blocked("publish_dns", "Publish the DNS records at your domain's DNS host, then check them.");
  done.push("publish_dns");
  if (!verified.some((d) => d.isDefault)) return blocked("set_default", "Make one verified domain the default sender.");
  done.push("set_default");
  return { done, step: "ready", next: "Email is ready to send.", ready: true };
}

export async function setupStatus(ctx: MailCtx): Promise<SetupOut> {
  const provider = await providerOf(ctx);
  const smtp = await smtpGet(ctx);
  const { domains } = await domainList(ctx, {});
  return {
    provider,
    smtp,
    domains,
    rechecks: allWatches(ctx),
    cleanups: openCleanups(ctx),
    ...planSetup(provider, smtp, domains),
  };
}

// ---- mail.setup.test_send

export interface TestSendIn {
  to: string;
  idempotencyKey: string;
}
export interface TestSendOut {
  messageId?: string;
  status: "queued" | "sent" | "held" | "suppressed";
  from: string;
  note?: string;
}

/**
 * Send one short test message to the address the person typed, from an address on the default verified domain. It goes through mail.send, so the Space's sending limits, the suppression list and the Gate decide
 * as for any other message: a held test says it is held. Nothing is sent to anyone else, and the message says what it is. Whether it was delivered shows on the message's trail once the provider reports.
 */
export async function testSend(ctx: MailCtx, input: TestSendIn): Promise<TestSendOut> {
  ensureAll(ctx);
  const to = typeof input.to === "string" ? input.to.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) bad(ctx, "Enter the email address to send the test to.");
  const status = await setupStatus(ctx);
  if (!status.ready) preconditionFailed(ctx, status.next);
  const domain = status.domains.find((d) => d.isDefault && d.verified) ?? status.domains.find((d) => d.verified);
  if (!domain) preconditionFailed(ctx, "Add and verify a sending domain first.");
  const host = `@${domain.name}`;
  const own = rowsOf(ctx.db.all(`SELECT * FROM mail_mailbox WHERE deleted_at IS NULL`)).filter(
    (m) => str(m, "address").endsWith(host) && can(ctx, "use", { type: "mailbox", id: str(m, "id") }),
  );
  const sender = first(own);
  if (!sender) preconditionFailed(ctx, `Make an address on ${domain.name} first, then send the test from it.`);
  const out = (await ctx.call("mail.send", {
    mailboxId: str(sender, "id"),
    senderId: str(sender, "id"),
    route: "space_domain",
    to: [{ address: to }],
    subject: "A test email from your Space",
    text: `This is a test message from ${str(sender, "address")}. If you can read it, sending from this address works. Nothing else was sent.`,
    idempotencyKey: input.idempotencyKey,
  })) as { messageId?: string; status: TestSendOut["status"]; note?: string };
  return {
    ...(out.messageId ? { messageId: out.messageId } : {}),
    status: out.status,
    from: str(sender, "address"),
    ...(out.note ? { note: out.note } : {}),
  };
}

// ---- mail.setup: the one tool a model is shown for email setup

interface SetupToolIn {
  action: "status" | "test" | "smtp_get" | "smtp_set" | "smtp_verify" | "address_list" | "address_add" | "address_move";
  [k: string]: unknown;
}
const ROUTE: Record<SetupToolIn["action"], string> = {
  status: "mail.setup.status",
  test: "mail.setup.test_send",
  smtp_get: "mail.smtp.get",
  smtp_set: "mail.smtp.set",
  smtp_verify: "mail.smtp.verify",
  address_list: "mail.address.list",
  address_add: "mail.address.add",
  address_move: "mail.address.move",
};

/** What each action takes: required fields, then optional ones (a trailing ?). A call that is wrong or short is answered with this, for that action, in one line. */
const SHAPE: Record<SetupToolIn["action"], string> = {
  status: "",
  test: "to",
  smtp_get: "",
  smtp_set: "host, port, username, passwordHandle, security?",
  smtp_verify: "host?, port?, security?, username?, passwordHandle?",
  address_list: "domainId?",
  address_add: "domainId, localPart, mailboxId?, title?",
  address_move: "domainId, localPart, fromMailboxId, mailboxId",
};
const fieldsOf = (shape: string): { name: string; required: boolean }[] =>
  shape
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => ({ name: x.replace(/\?$/, ""), required: !x.endsWith("?") }));

/** The same call asked twice is one call: the key is a hash of the action and its fields in a fixed order (field order and length never change it). A test email also carries the hour, so a test sent again later is sent again. */
function repeatKey(ctx: MailCtx, action: string, rest: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(rest).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  );
  const bucket = action === "test" ? Math.floor(ctx.now() / 3_600_000) : "";
  return `tool-${createHash("sha256").update(`${action}|${bucket}|${canonical}`).digest("hex").slice(0, 40)}`;
}

/** Routes to the capability behind the screen, so its permission, Gate and audit apply exactly as when a person presses the button. Nothing is decided here. */
export async function setupTool(ctx: MailCtx, input: SetupToolIn): Promise<{ result: unknown }> {
  const cap = ROUTE[input.action];
  if (!cap) bad(ctx, `mail.configure action is one of: ${Object.keys(ROUTE).join(", ")}.`);
  const { action: _action, ...rest } = input;
  const fields = fieldsOf(SHAPE[input.action]);
  const given = Object.keys(rest).filter((k) => rest[k] !== undefined);
  const unknown = given.filter((k) => !fields.some((f) => f.name === k));
  const missing = fields.filter((f) => f.required && rest[f.name] === undefined).map((f) => f.name);
  if (unknown.length || missing.length)
    bad(
      ctx,
      `mail.configure ${input.action} takes {${SHAPE[input.action]}}${missing.length ? `; missing ${missing.join(", ")}` : ""}${unknown.length ? `; not used: ${unknown.join(", ")}` : ""}.`,
    );
  // a call that needs a key to be safe to repeat gets one made from what it asks, so asking twice is one call
  const keyed = ["test", "address_add", "address_move"].includes(input.action)
    ? { ...rest, idempotencyKey: repeatKey(ctx, input.action, rest) }
    : rest;
  return { result: await ctx.call(cap, keyed) };
}
