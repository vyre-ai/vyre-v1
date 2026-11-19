// Console, Messaging, Email: the Space's email in one place (owner, 19 Nov 2026). The domain with its marks, the addresses with who sends as them and when mail last came, the templates, and how the Space sends.
// The picture comes from mail.setup.status, the same read agents and MCP use, so a page and an agent never disagree about what is missing. Built from the Console's own pieces (Section, Group, Row, IconTile, Glyph, Avatar, Menu).
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useObjectNames } from "../../objects/names.ts";
import { useConsoleData } from "../../shell/data.tsx";
import { Glyph } from "../../shell/glyphs.tsx";
import { Group, Section, pointer } from "../../shell/ui.tsx";
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
const MUTED = "var(--ink-3)" as string;

/** Which steps there are: a mail server step only exists for SMTP. */
export function visibleSteps(provider: Provider): readonly { key: StepKey; title: string }[] {
  return STEPS.filter((s) => provider === "smtp" || s.key !== "connect_server");
}

/** "4 min ago", "1 h ago", "Yesterday": when mail last came, in the fewest words. */
export function ago(at: number, now: number): string {
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "Yesterday" : `${d} days ago`;
}

/** One result as a mark: a check when it is good, a warning when it is not, a clock while it is pending. */
function Mark({ label, state }: { label: string; state: "pass" | "fail" | "pending" }): ReactElement {
  const ok = state === "pass";
  const bad = state === "fail";
  const color = (ok ? "var(--ok)" : bad ? "var(--warn)" : MUTED) as string;
  return (
    <View testID={`mark-${label}`} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Glyph name={ok ? "check" : bad ? "warn" : "clock"} size={13} color={color} />
      <Text style={{ fontSize: 12.5, color }}>{label}</Text>
    </View>
  );
}
function Marks({ d }: { d: Domain }): ReactElement {
  const receives = d.provider !== "smtp";
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Mark label="SPF" state={d.spf} />
      <Mark label="DKIM" state={d.dkim} />
      <Mark label="DMARC" state={d.dmarc} />
      {receives ? <Mark label="Receiving" state={d.verified ? "pass" : "pending"} /> : null}
    </View>
  );
}

/** A quiet link in a section head: a plus and a few words, not a button. */
function QuietLink({ label, onPress, testID }: { label: string; onPress(): void; testID: string }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={[
        { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4, paddingHorizontal: 6 },
        pointer,
      ]}
    >
      <Glyph name="plus" size={13} color={"var(--ink-2)" as string} />
      <Text style={{ fontSize: 13, color: "var(--ink-2)" as string }}>{label}</Text>
    </Pressable>
  );
}

/** The three dots at the end of the domain row: open it, check its DNS now, add another. */
function MoreButton({ entries, label }: { entries: MenuEntry[]; label: string }): ReactElement {
  const menu = useMenu();
  const ref = useRef<unknown>(null);
  return (
    <>
      <Pressable
        ref={(v) => {
          ref.current = v;
        }}
        accessibilityRole="button"
        accessibilityLabel={`More about ${label}`}
        testID="domain-more"
        onPress={() => {
          const box = (
            ref.current as { getBoundingClientRect?: () => { left: number; bottom: number } } | null
          )?.getBoundingClientRect?.();
          menu.show(entries, box?.left ?? 0, (box?.bottom ?? 0) + 4, "other", { label });
        }}
        style={[{ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 8 }, pointer]}
      >
        <Glyph name="more" size={16} color={"var(--ink-2)" as string} />
      </Pressable>
      {menu.element}
    </>
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
  const menuFor = (d: Domain): MenuEntry[] => [
    { label: "Open", onSelect: () => data.nav.openPage("domains", { domainId: d.id }) },
    { label: "Check DNS now", onSelect: () => void action.run("mail.domain.check", { domainId: d.id }, "DNS checked") },
    { label: "Add domain", onSelect: () => data.nav.openPage("domains", { create: "true" }) },
  ];
  return (
    <View testID="console-email">
      {setup.ready ? null : (
        <Section title="Next">
          <Group>
            {/* ui-rows-lint: not a list (one card with an icon and a sentence that wraps in full: an error must be read) */}
            <View style={{ flexDirection: "row", gap: 12, padding: 14, alignItems: "flex-start" }} testID="email-next">
              <IconTile icon="warn" tone="warn" />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 14, color: "var(--ink)" as string }}>Next step</Text>
                <Text style={{ fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string }}>{setup.next}</Text>
              </View>
            </View>
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
      <Section title={setup.domains.length > 1 ? "Domains" : "Domain"}>
        {setup.domains.length === 0 ? (
          <Group>
            <Row
              id="email-add-domain"
              leading={<IconTile icon="mail" />}
              title="Add the domain your email comes from"
              trailing={
                <Button
                  label="Add domain"
                  testID="email-add-domain"
                  onPress={() => data.nav.openPage("domains", { create: "true" })}
                />
              }
            />
          </Group>
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
                      mono
                      leading={<IconTile icon="mail" tone={tone} />}
                      title={d.name}
                      note={`${PROVIDER_NAME[d.provider]}${d.provider === "smtp" ? " · Sending only" : d.verified ? " · Sending and receiving" : ""}${d.isDefault ? " · Default" : ""}${stopped ? " · Stopped" : ""}`}
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
                          <MoreButton entries={menuFor(d)} label={d.name} />
                        </View>
                      }
                    />
                    {narrow ? (
                      <View style={{ paddingHorizontal: 58, paddingBottom: 12 }}>
                        <Marks d={d} />
                      </View>
                    ) : null}
                    {note ? (
                      <View style={{ paddingHorizontal: 58, paddingBottom: 12 }}>
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
      <TemplatesSection />
      <Section title="Sending provider">
        <Group>
          <Row
            id="email-provider"
            title={PROVIDER_NAME[setup.provider]}
            {...(setup.provider === "smtp" && setup.smtp.state === "failed" ? { note: "The last test failed" } : {})}
            trailing={
              <Glyph name={provider || setup.provider === "smtp" ? "chevD" : "chevR"} size={12} color={MUTED} />
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
type Inbox = CapMap["mail.inbox.monitor"]["out"]["inboxes"][number];
const NEW_INBOX = "new";

/** Who may send as an inbox: a small stack of faces from the shares on it (use or more). Nothing is drawn when nobody has been given it. */
function Senders({ mailboxId }: { mailboxId: string }): ReactElement | null {
  const shares = useRead<CapMap["access.shares_of"]["out"]>("access.shares_of", {
    resource: { type: "mailbox", id: mailboxId },
  });
  const people = (shares.data?.shares ?? [])
    .filter(
      (s) =>
        ["use", "edit", "manage"].includes(s.grant.level) &&
        ["person", "agent", "group"].includes(s.grant.subject.kind),
    )
    .map((s) => s.grant.subject);
  const names = useObjectNames({ identities: people, resources: [] });
  if (people.length === 0) return null;
  return (
    <View testID={`senders-${mailboxId}`} style={{ flexDirection: "row", alignItems: "center" }}>
      {
        // ui-rows-lint: not a list (overlapping faces in one stack)
        people.slice(0, 3).map((p, i) => (
          <View key={`${p.kind}:${p.id}`} style={{ marginLeft: i === 0 ? 0 : -6 }}>
            <Avatar
              name={names.identity(p)}
              seedId={p.id}
              kind={p.kind === "agent" ? "agent" : p.kind === "group" ? "group" : "person"}
              size={22}
            />
          </View>
        ))
      }
    </View>
  );
}

/** What an inbox is doing, at the end of its row: a warning with the one fix when it is broken, the time mail last came when it is fine, nothing loud otherwise. */
function InboxState({
  inbox,
  onFix,
  now,
}: {
  inbox: Inbox | undefined;
  onFix(): void;
  now: number;
}): ReactElement | null {
  if (!inbox) return null;
  if (inbox.state === "failing")
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Glyph name="warn" size={13} color={"var(--warn)" as string} />
        <Text style={{ fontSize: 12.5, color: "var(--warn)" as string }}>
          {/sign/i.test(inbox.problem?.reason ?? "") ? "Sign-in expired" : "Not receiving"}
        </Text>
        <Button label="Reconnect" testID={`address-fix-${inbox.address}`} onPress={onFix} />
      </View>
    );
  if (inbox.state === "paused") return <Text style={{ fontSize: 12.5, color: MUTED }}>Paused</Text>;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: (inbox.state === "late"
            ? "var(--warn)"
            : inbox.lastReceivedAt
              ? "var(--ok)"
              : "var(--ink-4)") as string,
        }}
      />
      <Text style={{ fontSize: 12.5, color: MUTED }}>
        {inbox.lastReceivedAt ? ago(inbox.lastReceivedAt, now) : "Nothing yet"}
      </Text>
    </View>
  );
}

/** Addresses on the Space's domains: an inbox's own address with the names that also reach it, who may send as it, when mail last came, and what is wrong. Taking a name that is in use is refused in words; moving one is its own step. */
function AddressSection({ domains }: { domains: Setup["domains"] }): ReactElement {
  const data = useConsoleData();
  const list = useRead<CapMap["mail.address.list"]["out"]>("mail.address.list", {});
  const boxes = useRead<CapMap["mail.mailbox.list"]["out"]>("mail.mailbox.list", { scope: "all", limit: 100 });
  const monitor = useRead<CapMap["mail.inbox.monitor"]["out"]>("mail.inbox.monitor", {});
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<Address | null>(null);
  const [open, setOpen] = useState("");
  const refresh = (): void => {
    list.refresh();
    boxes.refresh();
    monitor.refresh();
  };
  const inboxes = (boxes.data?.mailboxes ?? []).map((b) => ({ key: b.id, title: `${b.title} · ${b.address}` }));
  const rows = list.data?.addresses ?? [];
  const aliasesOf = (mailboxId: string): Address[] =>
    rows.filter((a) => a.kind === "alias" && a.mailboxId === mailboxId);
  const own = rows.filter((a) => a.kind === "mailbox");
  const orphans = rows.filter((a) => a.kind === "alias" && !own.some((o) => o.mailboxId === a.mailboxId));
  const stateOf = (mailboxId: string): Inbox | undefined =>
    monitor.data?.inboxes.find((i) => i.mailboxId === mailboxId);
  const now = data.clock().now;
  return (
    <Section
      title="Addresses"
      count={rows.length ? own.length + orphans.length : 0}
      right={<QuietLink label="New address" testID="address-new" onPress={() => setAdding(true)} />}
    >
      {!list.data ? (
        <ReadState error={list.error} retry={list.refresh} />
      ) : rows.length === 0 ? (
        <Help>No addresses yet.</Help>
      ) : (
        <Group>
          {
            // ui-rows-lint: not a list (each address is a ui Row, with the names that also reach it opened under it in the same card)
            [...own, ...orphans].map((a) => {
              const aliases = a.kind === "mailbox" ? aliasesOf(a.mailboxId) : [a];
              const also = a.kind === "mailbox" ? aliases.map((x) => `${x.address.split("@")[0]}@`) : [];
              return (
                <View key={a.address}>
                  <Row
                    id={`address-${a.address}`}
                    mono
                    leading={
                      <IconTile icon="mail" tone={stateOf(a.mailboxId)?.state === "failing" ? "warn" : undefined} />
                    }
                    title={a.address}
                    note={
                      a.kind === "alias"
                        ? `Delivers to ${a.mailboxTitle}`
                        : also.length
                          ? `Also ${also.join(", ")}`
                          : a.mailboxTitle
                    }
                    tall
                    {...(aliases.length ? { onPress: () => setOpen(open === a.address ? "" : a.address) } : {})}
                    trailing={
                      a.receives ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                          <Senders mailboxId={a.mailboxId} />
                          <InboxState
                            inbox={stateOf(a.mailboxId)}
                            now={now}
                            onFix={() => data.nav.openPage("inboxes", { mailboxId: a.mailboxId })}
                          />
                        </View>
                      ) : (
                        <Text style={{ fontSize: 12.5, color: MUTED }}>Send only</Text>
                      )
                    }
                  />
                  {open === a.address && aliases.length ? (
                    <View style={{ paddingLeft: 44, paddingBottom: 6 }}>
                      {aliases.map((x) => (
                        <Row
                          key={x.address}
                          mono
                          title={x.address}
                          trailing={
                            <Button label="Move" testID={`address-move-${x.address}`} onPress={() => setMoving(x)} />
                          }
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })
          }
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

/** The Space's email templates, from the same read the templates page uses: how many, which are changed, and a press opens one. */
function TemplatesSection(): ReactElement | null {
  const data = useConsoleData();
  const list = useRead<CapMap["mail.template.list"]["out"]>("mail.template.list", {});
  const templates = list.data?.templates ?? [];
  if (!list.data || templates.length === 0) return null;
  return (
    <Section title="Templates" count={templates.length}>
      <Group>
        {templates.map((t) => (
          <Row
            key={t.key}
            leading={<IconTile icon="doc" />}
            title={t.title}
            onPress={() => data.nav.openPage("templates", { templateKey: t.key })}
            trailing={
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ fontSize: 12.5, color: MUTED }}>{t.customised ? "Changed" : "Built in"}</Text>
                <Glyph name="chevR" size={12} color={MUTED} />
              </View>
            }
          />
        ))}
      </Group>
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
