// Console, Messaging, Email: the Space's email in one place (owner, 19 Nov 2026). The domain with its marks and a test, the addresses, what needs a look, and how the Space sends.
// The picture comes from mail.setup.status, the same read agents and MCP use, so a page and an agent never disagree about what is missing. Built from the Console's own pieces (Section, Group, Row, IconTile, Glyph).
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useConsoleData } from "../../shell/data.tsx";
import { Glyph } from "../../shell/glyphs.tsx";
import { Group, Section } from "../../shell/ui.tsx";
import { IconTile } from "../CiRunners.tsx";
import { Help, Actions, Button, TextBox, Note, ReadState, Select, attempt, useAction, useRead } from "../shared.tsx";

type Setup = CapMap["mail.setup.status"]["out"];
type Domain = Setup["domains"][number];
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
const PROVIDER_NAME: Record<Provider, string> = { resend: "Resend", mailgun: "Mailgun", smtp: "Your mail server" };

/** Which steps there are: a mail server step only exists for SMTP. */
export function visibleSteps(provider: Provider): readonly { key: StepKey; title: string }[] {
  return STEPS.filter((s) => provider === "smtp" || s.key !== "connect_server");
}

/** One DNS result as a mark: a check when it passes, a warning when it fails, a clock while it is pending. */
function Mark({ label, state }: { label: string; state: string }): ReactElement {
  const ok = state === "pass";
  const bad = state === "fail";
  return (
    <View testID={`mark-${label}`} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Glyph
        name={ok ? "check" : bad ? "warn" : "clock"}
        size={13}
        color={(ok ? "var(--ok)" : bad ? "var(--warn)" : "var(--ink-3)") as string}
      />
      <Text style={{ fontSize: 12.5, color: (ok ? "var(--ok)" : bad ? "var(--warn)" : "var(--ink-3)") as string }}>
        {label}
      </Text>
    </View>
  );
}
function Marks({ d }: { d: Domain }): ReactElement {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Mark label="SPF" state={d.spf} />
      <Mark label="DKIM" state={d.dkim} />
      <Mark label="DMARC" state={d.dmarc} />
    </View>
  );
}

export function EmailPage(): ReactElement {
  const data = useConsoleData();
  const query = useRead<Setup>("mail.setup.status", {});
  const action = useAction(query.refresh);
  const narrow = useWindowDimensions().width < 720;
  const [testing, setTesting] = useState("");
  const [provider, setProvider] = useState(false);
  if (!query.data) return <ReadState error={query.error} retry={query.refresh} />;
  const setup = query.data;
  const choose = (value: string): void => {
    if (value === setup.provider) return;
    void action.run("settings.set_space", { key: "mail.provider", value }, "Sending provider changed");
  };
  const verified = setup.domains.filter((d) => d.verified);
  return (
    <View testID="console-email">
      {setup.ready ? null : (
        <Section title="Next">
          <Group>
            <Row
              id="email-next"
              title="Next step"
              note={setup.next}
              tall
              leading={<IconTile icon="warn" tone="warn" />}
            />
          </Group>
        </Section>
      )}
      {setup.cleanups.length ? (
        <Section title="Needs a look" count={setup.cleanups.length}>
          <Group>
            {setup.cleanups.map((c) => (
              <Row
                key={c.id}
                leading={<IconTile icon="warn" tone="warn" />}
                title={
                  c.kind === "provider_route" ? "A mail route is being removed" : "A duplicate address was removed"
                }
                note={c.note}
                tall
              />
            ))}
          </Group>
        </Section>
      ) : null}
      <Section
        title={setup.domains.length > 1 ? "Domains" : "Domain"}
        right={
          <Button
            label="Add domain"
            testID="email-add-domain"
            onPress={() => data.nav.openPage("domains", { create: "true" })}
          />
        }
      >
        {setup.domains.length === 0 ? (
          <Help>Add the domain your email comes from.</Help>
        ) : (
          <Group>
            {
              // ui-rows-lint: not a list (each domain is a ui Row with its own marks and notes drawn under it in the same card)
              setup.domains.map((d) => {
                const stopped = !d.verified && setup.rechecks.some((r) => r.domainId === d.id && r.failures >= 2);
                const note = recheckNote(
                  setup.rechecks.find((r) => r.domainId === d.id),
                  d.verified,
                );
                const tone = d.verified ? (note ? "warn" : "ok") : "warn";
                return (
                  <View key={d.id}>
                    <Row
                      id={`domain-${d.id}`}
                      leading={<IconTile icon="mail" tone={tone} />}
                      title={d.name}
                      note={`${PROVIDER_NAME[d.provider]}${d.isDefault ? " · Default" : ""}${stopped ? " · Stopped" : ""}`}
                      tall
                      onPress={() => data.nav.openPage("domains", { domainId: d.id })}
                      trailing={
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                          {narrow ? null : <Marks d={d} />}
                          {d.verified && setup.ready ? (
                            <Button
                              label="Send a test"
                              testID="test-open"
                              onPress={() => setTesting(testing === d.id ? "" : d.id)}
                            />
                          ) : null}
                        </View>
                      }
                    />
                    {narrow ? (
                      <View style={{ paddingHorizontal: 58, paddingBottom: 12 }}>
                        <Marks d={d} />
                      </View>
                    ) : null}
                    {note ? (
                      <View style={{ paddingHorizontal: narrow ? 58 : 58, paddingBottom: 12 }}>
                        <Text style={{ fontSize: 12.5, lineHeight: 17, color: "var(--warn)" as string }}>{note}</Text>
                      </View>
                    ) : null}
                    {testing === d.id ? <TestSend onClose={() => setTesting("")} /> : null}
                  </View>
                );
              })
            }
          </Group>
        )}
      </Section>
      {verified.length ? <AddressSection domains={verified} /> : null}
      <Section title="Sending provider">
        <Group>
          <Row
            id="email-provider"
            title={PROVIDER_NAME[setup.provider]}
            note={setup.provider === "smtp" && setup.smtp.state === "failed" ? "The last test failed" : undefined}
            trailing={
              <Glyph name={provider || setup.provider === "smtp" ? "chevD" : "chevR"} size={12} color="var(--ink-3)" />
            }
            onPress={() => setProvider(!provider)}
          />
        </Group>
        {provider || setup.provider === "smtp" ? (
          <View style={{ marginTop: 12 }}>
            <Select
              label="Send through"
              value={setup.provider}
              options={PROVIDERS}
              onChange={choose}
              disabled={action.busy}
            />
            {setup.provider === "smtp" ? <SmtpForm smtp={setup.smtp} onSaved={query.refresh} /> : null}
          </View>
        ) : null}
      </Section>
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
    <View testID="smtp-form" style={{ marginTop: 8 }}>
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
    </View>
  );
}

/** The card a short form sits in under a list: the Console's own group, with room inside. */
function FormCard({ children }: { children: ReactNode }): ReactElement {
  return (
    <View style={{ marginTop: 12 }}>
      <Group>
        <View style={{ padding: 14, gap: 8 }}>{children}</View>
      </Group>
    </View>
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
        <Help>No addresses yet.</Help>
      ) : (
        <Group>
          {list.data.addresses.map((a) => (
            <Row
              key={a.address}
              leading={<IconTile icon="mail" tone={a.receives ? undefined : undefined} />}
              title={a.address}
              note={a.kind === "alias" ? `Delivers to ${a.mailboxTitle}` : a.mailboxTitle}
              tall
              trailing={
                a.receives ? (
                  a.kind === "alias" ? (
                    <Button label="Move" testID={`address-move-${a.address}`} onPress={() => setMoving(a)} />
                  ) : undefined
                ) : (
                  <Text style={{ fontSize: 12.5, color: "var(--ink-3)" as string }}>Send only</Text>
                )
              }
            />
          ))}
        </Group>
      )}
      {adding ? (
        <FormCard>
          <NewAddress
            domains={domains}
            inboxes={inboxes}
            onDone={() => {
              setAdding(false);
              refresh();
            }}
          />
        </FormCard>
      ) : null}
      {moving ? (
        <FormCard>
          <MoveAddress
            address={moving}
            inboxes={inboxes.filter((i) => i.key !== moving.mailboxId)}
            onDone={() => {
              setMoving(null);
              refresh();
            }}
          />
        </FormCard>
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
function TestSend({ onClose }: { onClose(): void }): ReactElement {
  const [to, setTo] = useState("");
  const [key, setKey] = useState(attempt);
  const action = useAction(() => undefined);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());
  return (
    <View
      testID="test-form"
      style={{ padding: 14, gap: 8, borderTopWidth: 1, borderTopColor: "var(--line)" as string }}
    >
      <TextBox label="Send a test to" testID="test-to" value={to} onChange={setTo} />
      <Actions>
        <Button label="Close" onPress={onClose} />
        <Button
          label="Send test"
          testID="test-send"
          primary
          disabled={!valid || action.busy}
          onPress={() =>
            void action
              .run<CapMap["mail.setup.test_send"]["out"]>(
                "mail.setup.test_send",
                { to: to.trim(), idempotencyKey: key },
                (o) =>
                  o.status === "sent" || o.status === "queued"
                    ? `Sent from ${o.from}.`
                    : o.status === "held"
                      ? (o.note ?? "Held by the Space's rules.")
                      : "That address is on the do-not-contact list, so nothing was sent.",
              )
              .then((out) => {
                if (out) setKey(attempt());
              })
          }
        />
      </Actions>
      {action.note ? <Note testID="test-note">{action.note}</Note> : null}
    </View>
  );
}

/** What the daily check found, in one short line: a first failure is a warning, the second has stopped the domain. */
export function recheckNote(r: Setup["rechecks"][number] | undefined, verified: boolean): string {
  if (!r) return "";
  const why = r.why ? `: ${r.why}` : ".";
  return verified ? `Last daily check failed${why}` : `Stopped after two failed daily checks${why}`;
}
