// Console, Messaging, Email: the templates page and the inbox health section (lane r42-email-in).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { ConsoleDataProvider } from "../../shell/data.tsx";
import type { ConsoleData } from "../../shell/data.tsx";
import { createSampleConsole } from "../../shell/sample.ts";
import { TemplatesPage } from "./Templates.tsx";
import { InboxesPage } from "./Inboxes.tsx";
import { trailHeadline } from "../../../places/inbox/contacttab/Trail.tsx";

function draw(element: ReactElement, rows: Record<string, unknown>): string {
  const sample = createSampleConsole().data;
  const data: ConsoleData = {
    ...sample,
    screens: {
      ...sample.screens,
      capQuery: (cap: string) => {
        const value = { status: "ready", data: rows[cap] };
        return { subscribe: () => () => undefined, getSnapshot: () => value };
      },
    } as never,
  };
  return renderToStaticMarkup(<ConsoleDataProvider value={data}>{element}</ConsoleDataProvider>);
}

const request = {
  key: "signature.request",
  title: "Signature request",
  subject: "{{sender_name}} asked you to sign {{document_title}}",
  text: "Hi {{signer_name|there}}",
  source: "builtin",
  version: 1,
  fields: [{ key: "sender_name" }, { key: "document_title" }, { key: "signer_name", fallback: "there" }],
};

test("the templates list names each template with its subject and says which the Space changed", () => {
  const html = draw(<TemplatesPage />, {
    "mail.template.list": {
      templates: [
        {
          key: "signature.request",
          title: "Signature request",
          subject: "Please sign",
          source: "space",
          customised: true,
        },
        {
          key: "signature.reminder",
          title: "Signature reminder",
          subject: "Reminder",
          source: "builtin",
          customised: false,
        },
      ],
    },
  });
  assert.match(html, /Signature request/);
  assert.match(html, /changed by your Space/);
  assert.match(html, /Signature reminder/);
  assert.doesNotMatch(html, /Reminder · changed/);
});

test("a template opens with its subject, body, field buttons, and a preview", () => {
  const html = draw(<TemplatesPage initialKey="signature.request" />, { "mail.template.get": { template: request } });
  assert.match(html, /template-subject/);
  assert.match(html, /template-field-sender_name/);
  assert.match(html, /Show it for this record/);
  assert.doesNotMatch(html, /Use the one that ships with Vyre/); // a built-in has nothing to go back to
  const mine = draw(<TemplatesPage initialKey="signature.request" />, {
    "mail.template.get": { template: { ...request, source: "space" } },
  });
  assert.match(mine, /Use the one that ships with Vyre/);
});

test("an inbox says whether it works, how mail arrives, and what failed with the fix", () => {
  const html = draw(<InboxesPage initialId="mbx_hello" />, {
    "mail.mailbox.get": {
      mailbox: {
        id: "mbx_hello",
        kind: "shared",
        address: "hello@vyre.test",
        title: "Hello",
        provider: "imap",
        privacy: "space",
        state: "error",
      },
    },
    "mail.route.list": { routes: [] },
    "mail.domain.list": { domains: [] },
    "mail.inbox.monitor": {
      inboxes: [
        {
          mailboxId: "mbx_hello",
          address: "hello@vyre.test",
          kind: "shared",
          how: "imap",
          state: "failing",
          receivedToday: 3,
          problem: {
            reason: "The mailbox did not accept the sign-in.",
            fix: "Open the mailbox and reconnect it.",
            at: 1,
          },
        },
      ],
      unrouted: [],
    },
  });
  assert.match(html, /Not working/);
  assert.match(html, /Reads the mailbox over IMAP/);
  assert.match(html, /did not accept the sign-in\. Open the mailbox and reconnect it/);
});

test("the line under a sent email says only what matters", () => {
  const base = { messageId: "eml_a", blocked: [] as { address: string; reason: string }[] };
  const ev = (kind: string, at: number, extra: object = {}) => ({ kind, at, label: kind, ...extra });
  assert.equal(
    trailHeadline(
      { ...base, state: "delivered", events: [ev("sent", 0), ev("delivered", 9 * 3_600_000 + 12 * 60_000)] } as never,
      "UTC",
    ),
    "Delivered 9:12 AM",
  );
  assert.equal(trailHeadline({ ...base, state: "sent", events: [ev("sent", 0)] } as never, "UTC"), "");
  assert.equal(
    trailHeadline(
      { ...base, state: "bounced", events: [ev("sent", 0), ev("bounced", 5, { detail: "No such user" })] } as never,
      "UTC",
    ),
    "Bounced: No such user",
  );
  assert.match(
    trailHeadline(
      {
        ...base,
        state: "retrying",
        events: [],
        retry: { address: "a@b.test", attempt: 1, of: 3, nextAt: 3_600_000 },
      } as never,
      "UTC",
    ),
    /Trying again at 1:00 AM \(2 of 3\)/,
  );
});

test("the Body box is tall enough for the words in it and grows with them", () => {
  const short = draw(<TemplatesPage initialKey="signature.request" />, {
    "mail.template.get": { template: { ...request, text: "Hi" } },
  });
  const long = draw(<TemplatesPage initialKey="signature.request" />, {
    "mail.template.get": {
      template: { ...request, text: Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n") },
    },
  });
  const height = (html: string): number =>
    Number(
      /data-testid="template-text"[^>]*min-height:(\d+)px/.exec(html)?.[1] ??
        /min-height:(\d+)px[^>]*data-testid="template-text"/.exec(html)?.[1] ??
        0,
    );
  assert.ok(height(short) >= 8 * 21, `short body box is ${height(short)}px`);
  assert.ok(height(long) > height(short));
});
