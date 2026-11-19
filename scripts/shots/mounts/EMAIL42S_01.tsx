// Mount for the Space's email setup page (lane r42-email), over scripted answers. ?part=
//   setup       Console, Messaging, Email on a Space that is ready to send: provider, steps, domain, addresses
//   smtp        a Space on its own mail server whose last test failed: the form, the reason, the next step
//   needs       a lost route race whose provider route is still being deleted, and a duplicate route removed from an older database
//   stopped     a domain stopped after two failed daily checks, and one warned after the first
// The targets (scripts/shots/targets/EMAIL42S_01.json) press the page's own buttons for New address, Move and Send test.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import type { ConsoleData } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole } from "../../../apps/app/src/console/shell/sample.ts";
import { EmailPage } from "../../../apps/app/src/console/pages/comms/Email.tsx";

export const title = "Email: setup, addresses, test send, what needs a look";

const T0 = 1_763_551_200_000; // a fixed morning, so every picture reads the same
const dom = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  provider: "resend",
  spf: "pass",
  dkim: "pass",
  dmarc: "pass",
  verified: true,
  isDefault: false,
  checkedAt: T0 - 3_600_000,
  ...over,
});
const SMTP_NONE = { configured: false, state: "none" };

function setupFor(part: string): Record<string, unknown> {
  const ready = {
    provider: "resend",
    smtp: SMTP_NONE,
    domains: [dom("dom_a", "northwind.example", { isDefault: true })],
    rechecks: [],
    cleanups: [],
    done: ["choose_provider", "add_domain", "publish_dns", "set_default"],
    step: "ready",
    next: "Email is ready to send.",
    ready: true,
  };
  if (part === "smtp")
    return {
      ...ready,
      provider: "smtp",
      smtp: {
        configured: true,
        host: "smtp.northwind.example",
        port: 587,
        security: "starttls",
        username: "he…@northwind.example",
        state: "failed",
        detail:
          "This server cannot open port 587. Some hosts, such as Railway, block mail ports. Try port 2525, or send with Mailgun or Resend, which use HTTPS.",
        checkedAt: T0 - 600_000,
      },
      domains: [dom("dom_a", "northwind.example", { provider: "smtp", verified: false, spf: "pass", dkim: "pending" })],
      done: ["choose_provider"],
      step: "connect_server",
      next: "The mail server test failed: This server cannot open port 587. Some hosts, such as Railway, block mail ports. Try port 2525, or send with Mailgun or Resend, which use HTTPS.",
      ready: false,
    };
  if (part === "needs")
    return {
      ...ready,
      cleanups: [
        {
          id: "cln_1",
          kind: "provider_route",
          note: "sales@northwind.example: a Mailgun route made by an add that lost a race could not be deleted yet. It is retried until it is gone.",
          attempts: 3,
          lastError: "provider.unavailable",
          createdAt: T0 - 1_800_000,
        },
        {
          id: "cln_2",
          kind: "duplicate_route",
          note: "billing@northwind.example had 2 routes. The oldest was kept and the other was removed, so mail goes to one inbox only.",
          attempts: 0,
          createdAt: T0 - 86_400_000,
        },
      ],
    };
  if (part === "stopped")
    return {
      ...ready,
      domains: [
        dom("dom_a", "northwind.example", { isDefault: true }),
        dom("dom_b", "mail.northwind.example", { dkim: "pass" }),
        dom("dom_c", "old.northwind.example", { verified: false, spf: "fail", dkim: "pass" }),
      ],
      rechecks: [
        { domainId: "dom_b", failures: 1, why: "DKIM no longer passes in DNS.", checkedAt: T0 - 3_600_000 },
        { domainId: "dom_c", failures: 2, why: "SPF no longer passes in DNS.", checkedAt: T0 - 3_600_000 },
      ],
    };
  return ready;
}

const addr = (
  address: string,
  mailboxId: string,
  mailboxTitle: string,
  kind: "mailbox" | "alias",
  receives = true,
) => ({
  address,
  domainId: "dom_a",
  kind,
  mailboxId,
  mailboxTitle,
  receives,
  ...(kind === "alias" ? { routeId: `rte_${address.split("@")[0]}` } : {}),
});
const ADDRESSES = [
  addr("hello@northwind.example", "mbx_hello", "Hello", "mailbox"),
  addr("hi@northwind.example", "mbx_hello", "Hello", "alias"),
  addr("info@northwind.example", "mbx_hello", "Hello", "alias"),
  addr("billing@northwind.example", "mbx_billing", "Billing", "mailbox"),
  addr("invoices@northwind.example", "mbx_billing", "Billing", "alias"),
  addr("accounts@northwind.example", "mbx_billing", "Billing", "alias"),
  addr("support@northwind.example", "mbx_support", "Support", "mailbox"),
  addr("sign@northwind.example", "mbx_sign", "Signing", "mailbox"),
  addr("no-reply@northwind.example", "mbx_noreply", "no-reply", "mailbox", false),
];
const MAILBOXES = ["hello:Hello", "billing:Billing", "support:Support", "sign:Signing"].map((x) => {
  const [k, title] = x.split(":");
  return {
    id: `mbx_${k}`,
    kind: "shared",
    address: `${k}@northwind.example`,
    title,
    provider: "inbound_only",
    privacy: "people",
    state: "syncing",
  };
});
const inbox = (
  k: string,
  state: string,
  ago: number | null,
  problem?: { reason: string; fix: string; at: number },
) => ({
  mailboxId: `mbx_${k}`,
  address: `${k}@northwind.example`,
  kind: "shared",
  how: "provider_webhook",
  state,
  ...(ago === null ? {} : { lastReceivedAt: T0 - ago }),
  receivedToday: 3,
  ...(problem ? { problem } : {}),
});
const MONITOR = {
  inboxes: [
    inbox("hello", "ok", 4 * 60_000),
    inbox("billing", "ok", 60 * 60_000),
    inbox("support", "failing", null, {
      reason: "The sign-in expired.",
      fix: "Reconnect the inbox.",
      at: T0 - 3_600_000,
    }),
    inbox("sign", "ok", 26 * 60 * 60_000),
  ],
  unrouted: [],
};
const share = (who: string, kind: string, level = "use") => ({
  grant: {
    id: `gr_${who}`,
    subject: { kind, id: who },
    resource: { type: "mailbox", id: "x" },
    level,
    by: "usr_a",
    createdAt: T0,
  },
  through: "direct",
});
const SHARES = { shares: [share("usr_maya01", "person"), share("usr_omar01", "person"), share("agt_intake", "agent")] };
const TEMPLATES = {
  templates: [
    {
      key: "signature.request",
      title: "Signature request",
      subject: "{{sender_name}} asked you to sign {{document_title}}",
      source: "space",
      customised: true,
      updatedAt: T0,
    },
    {
      key: "signature.reminder",
      title: "Signature reminder",
      subject: "Reminder",
      source: "builtin",
      customised: false,
    },
    { key: "signature.signed_copy", title: "Signed copy", subject: "Signed", source: "builtin", customised: false },
    { key: "welcome", title: "Welcome", subject: "Welcome", source: "space", customised: true, updatedAt: T0 },
  ],
};

function dataFor(part: string): ConsoleData {
  const base = createSampleConsole().data;
  const rows: Record<string, unknown> = {
    "mail.setup.status": setupFor(part),
    "mail.address.list": { addresses: ADDRESSES, total: ADDRESSES.length },
    "mail.mailbox.list": { mailboxes: MAILBOXES, total: MAILBOXES.length },
    "mail.inbox.monitor": MONITOR,
    "access.shares_of": SHARES,
    "mail.template.list": TEMPLATES,
  };
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    if (cap === "mail.setup.test_send")
      return { messageId: "eml_test0001", status: "sent", from: "hello@northwind.example" };
    return base.call(cap as never, input as never);
  };
  return {
    ...base,
    call: call as never,
    screens: {
      ...base.screens,
      capQuery: (cap: string) => {
        const state = rows[cap] === undefined ? { status: "loading" } : { status: "ready", data: rows[cap] };
        return { subscribe: () => () => undefined, getSnapshot: () => state };
      },
    } as never,
  };
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(
    () =>
      setPart(
        new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ??
          "setup",
      ),
    [],
  );
  const data = useMemo(() => (part ? dataFor(part) : null), [part]);
  if (part === null || data === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <ConsoleDataProvider value={data}>
      <View style={{ flex: 1, minHeight: 900, padding: 24, backgroundColor: "var(--win)" as string }}>
        <EmailPage />
      </View>
    </ConsoleDataProvider>
  );
}
