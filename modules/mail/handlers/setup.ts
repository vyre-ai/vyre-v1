// mail.setup.status: the Space's email setup in one read, for the Email page and for agents and MCP (owner, 19 Nov 2026: one place for provider, domain, DNS and a test).
// It answers three questions in plain words: which way does this Space send, what is still missing, and what is the next step.
// It reads only: the provider setting, the saved mail server (SMTP), and the sending domains with their DNS state.
import { domainList } from "./extra/domains.ts";
import type { DomainOut } from "./extra/domains.ts";
import { smtpGet } from "./smtp.ts";
import type { SmtpOut } from "./smtp.ts";
import type { MailCtx } from "../projections.ts";

export type SetupProvider = "resend" | "mailgun" | "smtp";
export type SetupStep = "choose_provider" | "connect_server" | "add_domain" | "publish_dns" | "set_default" | "ready";

export interface SetupOut {
  provider: SetupProvider;
  smtp: SmtpOut;
  domains: DomainOut[];
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
  return { provider, smtp, domains, ...planSetup(provider, smtp, domains) };
}
