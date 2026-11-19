// Mount for the Space's email screens (lane r42-email-in), over scripted answers. ?part=
//   templates        Console, Messaging, Email: the templates list, one changed by the Space
//   template         one template open: words, field buttons, preview that names a field that would go out empty
//   template-record  the same template previewed on a real record
//   inbox            a shared inbox that works: how mail arrives, last received, received today
//   inbox-failing    a shared inbox whose sign-in failed: the reason and the one fix
//   trail-delivered, trail-bounced, trail-retrying   the line under a sent email, opened into the whole trail
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import type { ConsoleData } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole } from "../../../apps/app/src/console/shell/sample.ts";
import { TemplatesPage } from "../../../apps/app/src/console/pages/comms/Templates.tsx";
import { InboxesPage } from "../../../apps/app/src/console/pages/comms/Inboxes.tsx";
import { DeliveryTrail } from "../../../apps/app/src/places/inbox/contacttab/Trail.tsx";

export const title = "Email: templates, inbox health, delivery trail";

const REQUEST = {
  key: "signature.request",
  title: "Signature request",
  subject: "{{sender_name}} asked you to sign {{document_title}}",
  text: "Hi {{signer_name|there}},\n\n{{sender_name}} asked you to sign {{document_title}}.\n\n{{message|}}\n\nOpen it here:\n{{sign_link}}\n\nThe link works until {{expires_on|it is cancelled}}.",
  source: "space",
  version: 2,
  fields: [{ key: "sender_name" }, { key: "document_title" }, { key: "signer_name", fallback: "there" }, { key: "message", fallback: "" }, { key: "sign_link" }, { key: "expires_on", fallback: "it is cancelled" }],
};
const T0 = 1_763_551_200_000; // a fixed morning, so every picture reads the same

function inboxRow(failing: boolean) {
  return {
    mailboxId: "mbx_hello",
    address: "hello@vyre.example",
    kind: "shared",
    how: "imap",
    state: failing ? "failing" : "ok",
    lastReceivedAt: T0 - 12 * 60_000,
    lastSyncAt: T0 - 2 * 60_000,
    receivedToday: 14,
    ...(failing ? { problem: { reason: "The mailbox did not accept the sign-in.", fix: "Open the mailbox and reconnect it.", at: T0 - 30 * 60_000 } } : {}),
  };
}

function dataFor(part: string): ConsoleData {
  const base = createSampleConsole().data;
  const rows: Record<string, unknown> = {
    "mail.template.list": {
      templates: [
        { key: "signature.request", title: "Signature request", subject: REQUEST.subject, source: "space", customised: true, updatedAt: T0 },
        { key: "signature.reminder", title: "Signature reminder", subject: "Reminder: {{document_title}} is waiting for your signature", source: "builtin", customised: false },
        { key: "signature.signed_copy", title: "Signed copy", subject: "{{document_title}} is signed", source: "builtin", customised: false },
        { key: "signature.expired", title: "Signature link expired", subject: "The link to sign {{document_title}} expired", source: "builtin", customised: false },
      ],
    },
    "mail.template.get": { template: REQUEST },
    "mail.mailbox.get": { mailbox: { id: "mbx_hello", kind: "shared", address: "hello@vyre.example", title: "Hello inbox", provider: "imap", privacy: "space", state: part === "inbox-failing" ? "error" : "syncing", lastSyncAt: T0 - 120_000 } },
    "mail.route.list": { routes: [] },
    "mail.domain.list": { domains: [] },
    "mail.inbox.monitor": { inboxes: [inboxRow(part === "inbox-failing")], unrouted: [] },
  };
  const values = { sender_name: "Pat Lee", document_title: "Service agreement", sign_link: "https://sign.vyre.example/a1", signer_name: "Sam Rivers" };
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    if (cap === "mail.template.preview") {
      const i = input as { text?: string; subject?: string; recordId?: string };
      const fill = (s: string): string => s.replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (_m, k: string, fb?: string) => (i.recordId || part !== "template") && k in values ? (values as Record<string, string>)[k]! : (fb ?? k.replace(/_/g, " ")));
      const full = part === "template-record" || !!i.recordId;
      return { subject: fill(i.subject ?? ""), text: fill(i.text ?? ""), source: "draft", blanks: full ? [] : ["sender_name", "document_title", "sign_link"], fallbacks: ["message"] };
    }
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

const TRAILS: Record<string, unknown> = {
  "trail-delivered": {
    messageId: "eml_a", state: "delivered", blocked: [],
    events: [
      { kind: "sent", at: T0, label: "Sent" },
      { kind: "delivered", at: T0 + 2_000, label: "Delivered", address: "sam@client.example" },
      { kind: "opened", at: T0 + 340_000, label: "Opened", address: "sam@client.example" },
    ],
  },
  "trail-bounced": {
    messageId: "eml_a", state: "bounced",
    blocked: [{ address: "sam@client.example", reason: "Their mail server says this address does not exist." }],
    events: [
      { kind: "sent", at: T0, label: "Sent" },
      { kind: "bounced", at: T0 + 3_000, label: "Bounced", address: "sam@client.example", detail: "No such user" },
    ],
  },
  "trail-retrying": {
    messageId: "eml_a", state: "retrying", blocked: [],
    retry: { address: "sam@client.example", attempt: 1, of: 3, nextAt: T0 + 5 * 60_000 },
    events: [
      { kind: "sent", at: T0, label: "Sent" },
      { kind: "soft_bounced", at: T0 + 4_000, label: "Could not deliver yet", address: "sam@client.example", detail: "Mailbox full" },
      { kind: "retry_scheduled", at: T0 + 4_100, label: "Will try again", address: "sam@client.example", detail: "Try 2 of 3" },
    ],
  },
};

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(
    () => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "templates"),
    [],
  );
  const data = useMemo(() => (part ? dataFor(part) : null), [part]);
  if (part === null || data === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (part.startsWith("trail-"))
    return (
      <View style={{ flex: 1, minHeight: 360, padding: 24, backgroundColor: "var(--win)" as string }} testID="email42-trail">
        <DeliveryTrail messageId="eml_a" offsetMin={0} call={async () => TRAILS[part]} />
      </View>
    );
  return (
    <ConsoleDataProvider value={data}>
      <View style={{ flex: 1, minHeight: 760, padding: 24, backgroundColor: "var(--win)" as string }}>
        {part === "templates" ? <TemplatesPage /> : part.startsWith("template") ? <TemplatesPage initialKey="signature.request" /> : <InboxesPage initialId="mbx_hello" />}
      </View>
    </ConsoleDataProvider>
  );
}
