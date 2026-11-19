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
import { Help, Button, TextBox, Note, ReadState, Select, useAction, useRead } from "../shared.tsx";
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
