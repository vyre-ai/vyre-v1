// Console, Messaging, Email: the Space's email in one place (owner, 19 Nov 2026). How it sends, the mail server when it is SMTP, the domains with their DNS, and the one next step.
// The picture comes from mail.setup.status, the same read agents and MCP use, so a page and an agent never disagree about what is missing.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { ObjectSection } from "../../../../../../ui/src/ObjectPage/index.tsx";
import { useConsoleData } from "../../shell/data.tsx";
import { Group, Section } from "../../shell/ui.tsx";
import { Help, Actions, Button, TextBox, Note, ReadState, Select, attempt, useAction, useRead } from "../shared.tsx";
import { providerName } from "./common.tsx";

type Setup = CapMap["mail.setup.status"]["out"];
type Provider = Setup["provider"];
type StepKey = Setup["step"];

const STEPS: readonly { key: StepKey; title: string }[] = [
  { key: "choose_provider", title: "How the Space sends" },
  { key: "connect_server", title: "Mail server" },
  { key: "add_domain", title: "Sending domain" },
  { key: "publish_dns", title: "DNS records" },
  { key: "set_default", title: "Default sender" },
];
const PROVIDERS = [
  { key: "resend", title: "Resend" },
  { key: "mailgun", title: "Mailgun" },
  { key: "smtp", title: "Your own mail server (SMTP)" },
] as const;
const dnsWord = (s: string): string => (s === "pass" ? "Passed" : s === "fail" ? "Needs attention" : "Pending");

/** Which steps the picture shows: a mail server step only exists for SMTP. */
export function visibleSteps(provider: Provider): readonly { key: StepKey; title: string }[] {
  return STEPS.filter((s) => provider === "smtp" || s.key !== "connect_server");
}

export function EmailPage(): ReactElement {
  const data = useConsoleData();
  const query = useRead<Setup>("mail.setup.status", {});
  const action = useAction(query.refresh);
  if (!query.data) return <ReadState error={query.error} retry={query.refresh} />;
  const setup = query.data;
  const choose = (value: string): void => {
    if (value === setup.provider) return;
    void action.run("settings.set_space", { key: "mail.provider", value }, "Sending provider changed");
  };
  return (
    <View testID="console-email">
      <Section title="Email">
        <Note testID="email-next">{setup.ready ? "Email is ready to send." : setup.next}</Note>
        <Group>
          {visibleSteps(setup.provider).map((s) => (
            <Row
              key={s.key}
              title={s.title}
              note={setup.done.includes(s.key) ? "Done" : s.key === setup.step ? "Next" : "Waiting"}
            />
          ))}
        </Group>
      </Section>
      <ObjectSection title="How the Space sends">
        <Select
          label="Sending provider"
          value={setup.provider}
          options={PROVIDERS}
          onChange={choose}
          disabled={action.busy}
        />
        <Help>
          Resend and Mailgun send over HTTPS. Your own mail server needs an open mail port; a host that blocks them is
          told so when you test.
        </Help>
      </ObjectSection>
      {setup.provider === "smtp" ? <SmtpForm smtp={setup.smtp} onSaved={query.refresh} /> : null}
      <ObjectSection title="Sending domains">
        {setup.domains.length === 0 ? (
          <Help>No sending domain yet. Add the domain your email comes from.</Help>
        ) : (
          <Group>
            {setup.domains.map((d) => (
              <Row
                key={d.id}
                title={d.name}
                note={`${providerName(d.provider)} · ${d.verified ? "Verified" : `SPF ${dnsWord(d.spf)}, DKIM ${dnsWord(d.dkim)}`}${d.isDefault ? " · Default sender" : ""}`}
                onPress={() => data.nav.openPage("domains", { domainId: d.id })}
              />
            ))}
          </Group>
        )}
        <Button
          label="Add domain"
          testID="email-add-domain"
          onPress={() => data.nav.openPage("domains", { create: "true" })}
        />
      </ObjectSection>
      {setup.ready ? <TestSend /> : null}
      {setup.domains.some((d) => d.verified) ? (
        <AddressSection domains={setup.domains.filter((d) => d.verified)} />
      ) : null}
      {query.error || action.note ? <Note>{query.error || action.note}</Note> : null}
    </View>
  );
}

function SmtpForm({ smtp, onSaved }: { smtp: Setup["smtp"]; onSaved(): void }): ReactElement {
  const [host, setHost] = useState(smtp.host ?? "");
  const [port, setPort] = useState(smtp.port ? String(smtp.port) : "587");
  const [username, setUsername] = useState(""); // never filled in: the saved one is shown only as a hint, and left out of the save it stays
  const [handle, setHandle] = useState("");
  const [result, setResult] = useState("");
  const action = useAction(onSaved);
  useEffect(() => {
    setHost(smtp.host ?? "");
    if (smtp.port) setPort(String(smtp.port));
  }, [smtp.host, smtp.port]);
  const portNumber = Number(port);
  const validPort = Number.isSafeInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
  const canSave =
    host.trim() !== "" && validPort && (smtp.configured || username.trim() !== "") && handle.trim() !== "";
  const save = async (): Promise<void> => {
    setResult("");
    const out = await action.run(
      "mail.smtp.set",
      {
        host: host.trim(),
        port: portNumber,
        ...(username.trim() ? { username: username.trim() } : {}),
        passwordHandle: handle.trim(),
      },
      "Mail server saved",
    );
    if (out) setHandle("");
  };
  const test = async (): Promise<void> => {
    const out = await action.run<CapMap["mail.smtp.verify"]["out"]>("mail.smtp.verify", {}, (o) =>
      o.ok ? "Connected and signed in." : o.message,
    );
    if (out) setResult(out.ok ? "Connected and signed in." : out.message);
  };
  return (
    <ObjectSection title="Mail server">
      <TextBox label="Server" testID="smtp-host" value={host} onChange={setHost} />
      <TextBox label="Port" testID="smtp-port" value={port} onChange={setPort} />
      <TextBox
        label="Username"
        testID="smtp-username"
        value={username}
        onChange={setUsername}
        {...(smtp.username ? { hint: `Saved: ${smtp.username}. Leave this empty to keep it.` } : {})}
      />
      <TextBox
        label="Password handle in the Vault"
        testID="smtp-handle"
        value={handle}
        onChange={setHandle}
        hint="Keep the password in the Vault as a Login or API key item and give its handle, like #Smtp_Password. Give it again whenever you change the server, port or username."
      />
      <Button
        label="Save"
        testID="smtp-save"
        disabled={!canSave || action.busy}
        {...(!canSave ? { why: "Fill in every field" } : {})}
        onPress={() => void save()}
      />
      <Button
        label="Test server"
        testID="smtp-test"
        disabled={!smtp.configured || action.busy}
        {...(!smtp.configured ? { why: "Save the server first" } : {})}
        onPress={() => void test()}
      />
      {smtp.state === "failed" && smtp.detail && !result ? <Note>{smtp.detail}</Note> : null}
      {result ? <Note testID="smtp-result">{result}</Note> : null}
    </ObjectSection>
  );
}

type Address = CapMap["mail.address.list"]["out"]["addresses"][number];
const NEW_INBOX = "new";

/** Addresses on the Space's domains: any name, an inbox behind it or an alias into one that exists, and moving one on purpose. Taking a name that is in use is refused in words; moving is its own step that names where it goes now. */
function AddressSection({ domains }: { domains: Setup["domains"] }): ReactElement {
  const list = useRead<CapMap["mail.address.list"]["out"]>("mail.address.list", {});
  const boxes = useRead<CapMap["mail.mailbox.list"]["out"]>("mail.mailbox.list", { scope: "all", limit: 100 });
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<Address | null>(null);
  const refresh = (): void => {
    list.refresh();
    boxes.refresh();
  };
  const inboxes = (boxes.data?.mailboxes ?? []).map((b) => ({ key: b.id, title: `${b.title} · ${b.address}` }));
  return (
    <Section
      title="Addresses"
      count={list.data?.addresses.length ?? 0}
      right={<Button label="New address" testID="address-new" onPress={() => setAdding(true)} />}
    >
      {!list.data ? (
        <ReadState error={list.error} retry={list.refresh} />
      ) : list.data.addresses.length === 0 ? (
        <Help>No addresses yet. Make one, such as billing or support.</Help>
      ) : (
        <Group>
          {list.data.addresses.map((a) => (
            <Row
              key={a.address}
              title={a.address}
              note={
                a.receives
                  ? a.kind === "alias"
                    ? `Also delivers to ${a.mailboxTitle}`
                    : `Inbox: ${a.mailboxTitle}`
                  : "Sends only: mail to it arrives at your own mail server"
              }
              {...(a.kind === "alias"
                ? { noteAction: { label: "Move", onPress: () => setMoving(a), testID: `address-move-${a.address}` } }
                : {})}
            />
          ))}
        </Group>
      )}
      {adding ? (
        <NewAddress
          domains={domains}
          inboxes={inboxes}
          onDone={() => {
            setAdding(false);
            refresh();
          }}
        />
      ) : null}
      {moving ? (
        <MoveAddress
          address={moving}
          inboxes={inboxes.filter((i) => i.key !== moving.mailboxId)}
          onDone={() => {
            setMoving(null);
            refresh();
          }}
        />
      ) : null}
    </Section>
  );
}

function NewAddress({
  domains,
  inboxes,
  onDone,
}: {
  domains: Setup["domains"];
  inboxes: { key: string; title: string }[];
  onDone(): void;
}): ReactElement {
  const [name, setName] = useState("");
  const [domainId, setDomainId] = useState(domains.find((d) => d.isDefault)?.id ?? domains[0]?.id ?? "");
  const [goesTo, setGoesTo] = useState(NEW_INBOX);
  const [key, setKey] = useState(attempt); // one key per attempt: pressing Create twice is one add, and a retry after a failure finishes it
  const action = useAction(onDone);
  const domain = domains.find((d) => d.id === domainId);
  const sendOnly = domain?.provider === "smtp";
  const valid = /^[a-z0-9]([a-z0-9._+-]*[a-z0-9])?$/i.test(name.trim()) && domainId !== "";
  const create = async (): Promise<void> => {
    const out = await action.run(
      "mail.address.add",
      {
        domainId,
        localPart: name.trim().toLowerCase(),
        ...(goesTo !== NEW_INBOX && !sendOnly ? { mailboxId: goesTo } : {}),
        idempotencyKey: key,
      },
      "Address ready",
    );
    if (out) setKey(attempt());
  };
  return (
    <View testID="address-new-form">
      <TextBox
        label="Name"
        testID="address-name"
        value={name}
        onChange={setName}
        hint="The part before the @, such as billing."
      />
      <Select
        label="Domain"
        value={domainId}
        options={domains.map((d) => ({ key: d.id, title: d.name }))}
        onChange={setDomainId}
      />
      {sendOnly ? (
        <Help>This domain's mail arrives at your own mail server, so this address can send but not receive here.</Help>
      ) : (
        <Select
          label="Mail goes to"
          value={goesTo}
          options={[{ key: NEW_INBOX, title: "A new inbox for this address" }, ...inboxes]}
          onChange={setGoesTo}
        />
      )}
      <Actions>
        <Button label="Cancel" onPress={onDone} />
        <Button
          label="Create"
          testID="address-create"
          primary
          disabled={!valid || action.busy}
          onPress={() => void create()}
        />
      </Actions>
      {action.note ? <Note testID="address-note">{action.note}</Note> : null}
    </View>
  );
}

function MoveAddress({
  address,
  inboxes,
  onDone,
}: {
  address: Address;
  inboxes: { key: string; title: string }[];
  onDone(): void;
}): ReactElement {
  const [to, setTo] = useState("");
  const [key] = useState(attempt);
  const action = useAction(onDone);
  const local = address.address.split("@")[0] ?? "";
  return (
    <View testID="address-move-form">
      <Note>
        {address.address} goes to {address.mailboxTitle} now. Choose where it should go instead; mail to it moves at
        once.
      </Note>
      <Select label="New inbox" value={to} options={inboxes} onChange={setTo} />
      <Actions>
        <Button label="Cancel" onPress={onDone} />
        <Button
          label="Move"
          testID="address-move"
          primary
          disabled={to === "" || action.busy}
          onPress={() =>
            void action.run(
              "mail.address.move",
              {
                domainId: address.domainId,
                localPart: local,
                fromMailboxId: address.mailboxId,
                mailboxId: to,
                idempotencyKey: key,
              },
              (o: CapMap["mail.address.move"]["out"]) => `${address.address} now goes to ${o.to}`,
            )
          }
        />
      </Actions>
      {action.note ? <Note testID="address-move-note">{action.note}</Note> : null}
    </View>
  );
}

/** One short test email to an address you type. It goes through the same door as every send, so a held test says it is held. */
function TestSend(): ReactElement {
  const [to, setTo] = useState("");
  const [key, setKey] = useState(attempt);
  const [result, setResult] = useState("");
  const action = useAction(() => undefined);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());
  return (
    <ObjectSection title="Send a test">
      <TextBox label="Send a test email to" testID="test-to" value={to} onChange={setTo} />
      <Button
        label="Send test"
        testID="test-send"
        disabled={!valid || action.busy}
        onPress={() =>
          void action
            .run<CapMap["mail.setup.test_send"]["out"]>(
              "mail.setup.test_send",
              { to: to.trim(), idempotencyKey: key },
              (o) =>
                o.status === "sent" || o.status === "queued"
                  ? `Sent from ${o.from}. It should arrive in a moment.`
                  : o.status === "held"
                    ? (o.note ?? "Held by the Space's rules.")
                    : "That address is on the do-not-contact list, so nothing was sent.",
            )
            .then((out) => {
              if (out) {
                setKey(attempt());
                setResult(out.status);
              }
            })
        }
      />
      {action.note ? <Note testID="test-note">{action.note}</Note> : null}
      {result === "" ? null : <View testID="test-result" />}
    </ObjectSection>
  );
}
