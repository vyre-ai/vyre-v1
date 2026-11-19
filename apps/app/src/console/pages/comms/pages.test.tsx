import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { ConsoleDataProvider } from "../../shell/data.tsx";
import type { ConsoleData } from "../../shell/data.tsx";
import { createSampleConsole } from "../../shell/sample.ts";
import { DomainsPage } from "./Domains.tsx";
import { InboxesPage } from "./Inboxes.tsx";
import { NumbersPage } from "./Numbers.tsx";
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
const domain = {
  id: "dom_fixture",
  name: "mail.fixture.example",
  provider: "resend",
  verified: false,
  isDefault: false,
  spf: "pending",
  dkim: "pending",
  dmarc: "pending",
};
test("Sending domain object exposes persisted full DNS records before a check and uses shared object tabs", () => {
  const record = {
    purpose: "dkim",
    type: "TXT",
    name: "selector._domainkey.fixture.example",
    value: "v=DKIM1; p=fixture-public-record-value",
    state: "pending",
  };
  const html = draw(<DomainsPage initialId={domain.id} />, {
    "mail.domain.get": { domain, records: [record] },
    "mail.domain.list": { domains: [domain] },
  });
  for (const value of ["DNS verification", record.value, "Copy value", "Overview", "Access", "Activity"])
    assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /Provider \(resend or mailgun\)/);
});
test("Shared inbox object resolves route domains to names and never exposes domain/mailbox ids as labels", () => {
  const inbox = {
    id: "mbx_fixture",
    kind: "shared",
    title: "Support",
    address: "support@fixture.example",
    provider: "inbound_only",
    privacy: "space",
    state: "syncing",
  };
  const html = draw(<InboxesPage initialId={inbox.id} />, {
    "mail.mailbox.get": { mailbox: inbox },
    "mail.mailbox.list": { mailboxes: [inbox] },
    "mail.route.list": {
      routes: [{ id: "rte_fixture", domainId: domain.id, localPart: "help", mailboxId: inbox.id, provider: "resend" }],
    },
    "mail.domain.list": { domains: [{ ...domain, verified: true }] },
  });
  const text = html.replace(/<[^>]*>/g, "");
  assert.ok(text.includes("help@mail.fixture.example"));
  assert.doesNotMatch(text, /dom_fixture|mbx_fixture|Privacy \(private/);
  assert.ok(html.includes("comms-object"));
});
test("Number object shows the named assignee with routing/hours status without raw identity ids", () => {
  const number = {
    id: "num_fixture",
    e164: "+15555550123",
    title: "Fixture support",
    capabilities: ["voice", "sms"],
    assigneeKind: "person",
    assigneeId: "usr_fixture",
    route: { ring: [], ringSeconds: 20, voicemail: true, voicemailTranscript: true },
    hours: { zone: "UTC", weekly: [], outsideHours: "voicemail" },
    recording: "off",
    a2p: "none",
    state: "active",
  };
  const html = draw(<NumbersPage initialId={number.id} />, {
    "telephony.number.get": { number },
    "telephony.number.list": { numbers: [number] },
    "access.principals.get": { principal: { id: "usr_fixture", kind: "person", name: "Fixture Operator" } },
  });
  const text = html.replace(/<[^>]*>/g, "");
  assert.ok(text.includes("Fixture Operator"));
  assert.doesNotMatch(text, /usr_fixture/);
  assert.ok(text.includes("Time zone"));
});
test("Sending domains says in one plain line what a sending domain does for notice email", () => {
  for (const domains of [[], [domain]]) {
    const html = draw(<DomainsPage />, { "mail.domain.list": { domains } });
    assert.ok(
      html.includes(
        "Vyre emails notices, such as a Space deletion, from a service mailbox on a verified domain here. Without one, people see notices in the app only.",
      ),
      JSON.stringify(domains),
    );
  }
});

test("Email setup shows the next step, ticks the finished ones and shows the mail server form only for SMTP", async () => {
  const { EmailPage, visibleSteps } = await import("./Email.tsx");
  const base = {
    provider: "smtp",
    smtp: {
      configured: true,
      host: "smtp.fixture.example",
      port: 587,
      security: "starttls",
      username: "me@fixture.example",
      state: "failed",
      detail: "Port 587 is blocked.",
    },
    domains: [],
    rechecks: [],
    cleanups: [],
    done: ["choose_provider"],
    step: "connect_server",
    next: "The mail server test failed: Port 587 is blocked.",
    ready: false,
  };
  const smtpHtml = draw(<EmailPage />, { "mail.setup.status": base });
  assert.match(smtpHtml, /Port 587 is blocked/);
  assert.match(smtpHtml, /smtp-host/);
  const resend = draw(<EmailPage />, {
    "mail.setup.status": {
      ...base,
      provider: "resend",
      smtp: { configured: false, state: "none" },
      step: "add_domain",
      next: "Add the domain your email comes from.",
    },
  });
  assert.doesNotMatch(resend, /smtp-host/);
  assert.match(resend, /Add the domain your email comes from/);
  assert.equal(
    visibleSteps("resend").some((s) => s.key === "connect_server"),
    false,
  );
  assert.equal(
    visibleSteps("smtp").some((s) => s.key === "connect_server"),
    true,
  );
});

test("Email setup lists the addresses with where each goes, offers New address and Move on aliases, and says so when an address only sends", async () => {
  const { EmailPage } = await import("./Email.tsx");
  const setup = {
    provider: "resend",
    smtp: { configured: false, state: "none" },
    domains: [
      {
        id: "dom_a",
        name: "northwind.example",
        provider: "resend",
        verified: true,
        isDefault: true,
        spf: "pass",
        dkim: "pass",
        dmarc: "pass",
      },
    ],
    rechecks: [],
    cleanups: [],
    done: ["choose_provider", "add_domain", "publish_dns", "set_default"],
    step: "ready",
    next: "Email is ready to send.",
    ready: true,
  };
  const addresses = [
    {
      address: "hello@northwind.example",
      domainId: "dom_a",
      kind: "mailbox",
      mailboxId: "mbx_h",
      mailboxTitle: "Hello",
      receives: true,
    },
    {
      address: "billing@northwind.example",
      domainId: "dom_a",
      kind: "alias",
      mailboxId: "mbx_h",
      mailboxTitle: "Hello",
      routeId: "rte_1",
      receives: true,
    },
    {
      address: "noreply@northwind.example",
      domainId: "dom_a",
      kind: "mailbox",
      mailboxId: "mbx_n",
      mailboxTitle: "noreply",
      receives: false,
    },
  ];
  const html = draw(<EmailPage />, {
    "mail.setup.status": setup,
    "mail.address.list": { addresses, total: 3 },
    "mail.mailbox.list": { mailboxes: [], total: 0 },
  });
  assert.match(html, /address-new/);
  assert.match(html, /hello@northwind\.example/);
  assert.match(html, /Delivers to Hello|Also billing@/);
  assert.match(html, /Also billing@/);
  assert.doesNotMatch(html, /address-move-hello@/);
  assert.match(html, /Send only/);
  // without a verified domain there is nowhere to make an address yet
  const none = draw(<EmailPage />, {
    "mail.setup.status": {
      ...setup,
      domains: [],
      step: "add_domain",
      ready: false,
      next: "Add the domain your email comes from.",
    },
  });
  assert.doesNotMatch(none, /address-new/);
});

test("Email setup offers a test send only when the setup is ready", async () => {
  const { EmailPage } = await import("./Email.tsx");
  const base = {
    provider: "resend",
    smtp: { configured: false, state: "none" },
    domains: [
      {
        id: "dom_a",
        name: "northwind.example",
        provider: "resend",
        verified: true,
        isDefault: true,
        spf: "pass",
        dkim: "pass",
        dmarc: "pass",
      },
    ],
    rechecks: [],
    cleanups: [],
    done: ["choose_provider", "add_domain", "publish_dns", "set_default"],
    step: "ready",
    next: "Email is ready to send.",
    ready: true,
  };
  const rows = { "mail.address.list": { addresses: [], total: 0 }, "mail.mailbox.list": { mailboxes: [], total: 0 } };
  assert.match(draw(<EmailPage />, { ...rows, "mail.setup.status": base }), /test-open/);
  assert.doesNotMatch(
    draw(<EmailPage />, {
      ...rows,
      "mail.setup.status": { ...base, ready: false, step: "publish_dns", next: "Publish the DNS records." },
    }),
    /test-open/,
  );
});

test("the daily re-check is shown on the domain: a first failure as a warning, the second as stopped, with the reason", async () => {
  const { recheckNote } = await import("./Email.tsx");
  assert.equal(recheckNote(undefined, true), "");
  assert.match(
    recheckNote({ domainId: "d", failures: 1, why: "DKIM no longer passes in DNS." }, true),
    /^Last daily check failed: DKIM no longer passes in DNS\.$/,
  );
  assert.match(
    recheckNote({ domainId: "d", failures: 2, why: "SPF no longer passes in DNS." }, false),
    /^Stopped after two failed daily checks: SPF no longer passes in DNS\.$/,
  );
});
