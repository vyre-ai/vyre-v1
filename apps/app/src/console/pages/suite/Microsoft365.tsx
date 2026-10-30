// Console > Integrations > Microsoft 365: the guided admin setup for an app registration with admin consent. Seven numbered steps with the exact permissions to add, a Copy button on every
// value, the consent link and the PowerShell that limits the app to the members you include, then the service rows and who is included. The client secret goes to the Vault the moment it is
// pasted and is never drawn again.
import { useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Section } from "../../shell/ui.tsx";
import { Actions, Button, Field, Note, ReadState, useAction, useRead } from "../shared.tsx";
import { Banner, Directory, MatchPerson, Bullets, CodeBlock, CopyRow, Members, OpenLink, Para, Services, Step, StepsCard } from "./parts.tsx";
import type { StepState } from "./parts.tsx";
import { matchPerson, unmatchPerson, connectedLine, memberToggle, microsoftCheckLine, microsoftChecked, storeInVault } from "./flow.ts";
import type { Checked } from "./flow.ts";
import type { DirPerson, Invited } from "./parts.tsx";
import { MICROSOFT_HANDLE, MICROSOFT_LINKS, MICROSOFT_PERMISSION_USE, microsoftSecret, serviceRows, summaryOf } from "./model.ts";
import type { MemberRow } from "./model.ts";

type Status = CapMap["ms.consent.status"]["out"];

export function Microsoft365Page(): ReactElement {
  const status = useRead<Status>("ms.consent.status", {});
  const configured = status.data?.configured === true;
  const link = useRead<CapMap["ms.consent.link"]["out"]>("ms.consent.link", {}, { enabled: configured });
  const snippet = useRead<CapMap["ms.consent.policy_snippet"]["out"]>("ms.consent.policy_snippet", {}, { enabled: configured });
  const members = useRead<CapMap["ms.consent.members"]["out"]>("ms.consent.members", { limit: 100 }, { enabled: configured });
  const folders = useRead<CapMap["vault.folders.list"]["out"]>("vault.folders.list", { scope: "shared" });
  const items = useRead<CapMap["vault.items.list"]["out"]>("vault.items.list", { q: "Microsoft_App", section: "shared" });
  const people = useRead<CapMap["access.principals.list"]["out"]>("access.principals.list", { kind: "person", status: "active", limit: 200 }, { enabled: configured });
  const refresh = (): void => { status.refresh(); link.refresh(); snippet.refresh(); members.refresh(); folders.refresh(); items.refresh(); };
  const act = useAction(refresh);

  const [tenant, setTenant] = useState("");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [domain, setDomain] = useState("");
  const [problem, setProblem] = useState("");
  const [ranPolicy, setRanPolicy] = useState(false);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [dir, setDir] = useState<DirPerson[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [links, setLinks] = useState<Invited[]>([]);

  if (!status.data) return <ReadState error={status.error} retry={status.refresh} />;
  const s = status.data;
  const stored = (items.data?.items ?? []).find((i) => i.handle === MICROSOFT_HANDLE);
  const tenantId = tenant || s.tenantId || "";
  const verified = s.lastVerifyAt !== undefined;
  const rows = serviceRows("microsoft", { configured, checked, lastOk: verified ? s.consentGiven : null });
  const memberRows: MemberRow[] = (members.data?.members ?? []).map((m) => ({ email: m.email, userId: m.userId, mapped: m.mapped, excluded: m.excluded, mailboxState: m.mailboxState }));
  const included = memberRows.filter((m) => m.mapped && !m.excluded).length;
  const summary = summaryOf("microsoft", rows, configured, included);

  const done = [Boolean(stored) || configured, Boolean(stored) || configured, Boolean(stored) || configured, configured, s.consentGiven, s.policyConfirmed, checked?.ok === true || (verified && s.consentGiven)];
  const firstOpen = done.findIndex((d) => !d);
  const stateOf = (i: number): StepState => (done[i] ? "done" : i === firstOpen ? "next" : "later");

  const saveCredentials = async (): Promise<void> => {
    const made = microsoftSecret({ tenantId, clientId, clientSecret: secret });
    if (!made.ok) { setProblem(made.problem); return; }
    setProblem("");
    const ok = await storeInVault(act.run, { name: "Microsoft_App", handle: MICROSOFT_HANDLE, text: made.value, folders: folders.data?.folders ?? [], existingItemId: stored?.id });
    if (ok) { setSecret(""); setClientId(""); }
  };

  const connect = async (): Promise<void> => {
    if (!tenantId) { setProblem("Enter the tenant ID from step 1 and save the credentials first."); return; }
    setProblem("");
    const d = domain.trim().toLowerCase();
    await act.run<CapMap["ms.consent.setup"]["out"]>("ms.consent.setup", { vaultItem: MICROSOFT_HANDLE, tenantId, ...(d ? { domain: d } : {}), idempotencyKey: "" }, (out) => connectedLine(out.mappedMembers, out.connected));
  };

  const verify = async (): Promise<void> => {
    await act.run<CapMap["ms.consent.verify"]["out"]>("ms.consent.verify", { ...(ranPolicy ? { policyConfirmed: true } : {}) }, (out) => { setChecked(microsoftChecked(out)); return microsoftCheckLine(out); });
  };

  const peopleOptions = (people.data?.principals ?? []).map((p) => ({ key: p.id, title: p.name ?? p.id }));
  const loadDirectory = async (): Promise<void> => {
    await act.run<{ people: DirPerson[] }>("ms.directory.list", {}, (out) => { setDir(out.people); setPicked(new Set()); return `${out.people.length} ${out.people.length === 1 ? "person" : "people"} in your directory.`; });
  };
  const inviteChosen = async (): Promise<void> => {
    await act.run<{ invited: Invited[]; skipped: { email: string; reason: string }[] }>("ms.directory.import", { people: [...picked].map((email) => ({ email, role: "rol_member" })), idempotencyKey: "" }, (out) => {
      setLinks(out.invited); setPicked(new Set());
      return `${out.invited.length} invitation${out.invited.length === 1 ? "" : "s"} made${out.skipped.length ? `, ${out.skipped.length} skipped: ${out.skipped.map((x) => `${x.email} (${x.reason})`).join("; ")}` : ""}.`;
    });
  };
  const toggle = (m: MemberRow): Promise<unknown> => memberToggle(act.run, "ms.consent.set_excluded", m);

  const off = async (): Promise<void> => {
    setConfirmOff(false);
    const out = await act.run("ms.consent.disable", {}, "Microsoft 365 is turned off. Syncing has stopped for every member.");
    if (out) setChecked(null);
  };

  const steps = (
    <StepsCard>
      <Step n={1} title="Register an app in Microsoft Entra" state={stateOf(0)}>
        <Para>You need to be a global administrator or application administrator of your Microsoft 365 tenant.</Para>
        <OpenLink url={MICROSOFT_LINKS.appRegistrations} label="Open App registrations in Microsoft Entra" testID="link-app-registrations" />
        <Bullets items={["Choose New registration and name it Vyre.", "Leave Accounts in this organizational directory only selected. No redirect address is needed.", "On the Overview page, copy the Directory (tenant) ID and the Application (client) ID. You paste both in step 3."]} />
      </Step>
      <Step n={2} title="Add the application permissions" state={stateOf(1)}>
        <Para>Open API permissions, choose Add a permission, Microsoft Graph, Application permissions, and add each one below. Do not use Delegated permissions.</Para>
        <View style={{ gap: 8 }}>
          {/* ui-rows-lint: not a list (values to copy inside a step, not list items) */}
          {(link.data?.permissions ?? Object.keys(MICROSOFT_PERMISSION_USE)).map((p) => <CopyRow key={p} label={p} value={p} note={MICROSOFT_PERMISSION_USE[p]} testID={`permission-${p}`} />)}
        </View>
      </Step>
      <Step n={3} title="Create a client secret and add it to the Vault" state={stateOf(2)}>
        <Para>Open Certificates and secrets, choose New client secret, and copy its Value now. Microsoft shows it only once. Paste the three values here; the Vault keeps them and this page will never show the secret again.</Para>
        <Field label="Directory (tenant) ID" value={tenantId} onChange={setTenant} testID="ms-tenant" />
        <Field label="Application (client) ID" value={clientId} onChange={setClientId} testID="ms-client-id" />
        <Field label="Client secret value" value={secret} onChange={setSecret} secure testID="ms-secret" />
        <Actions><Button label={stored ? "Replace credentials in the Vault" : "Save to the Vault"} disabled={act.busy || !secret} testID="ms-save" onPress={() => void saveCredentials()} /></Actions>
        {stored ? <Para>The credentials are in the Vault as {MICROSOFT_HANDLE}.</Para> : null}
      </Step>
      <Step n={4} title="Connect" state={stateOf(3)}>
        <Para>Vyre signs in with the saved credentials and matches your members by email. Type your firm's email domain to match only addresses on it; leave it empty to match everyone.</Para>
        <Field label="Email domain (optional)" value={domain} onChange={setDomain} testID="ms-domain" />
        <Actions><Button label={configured ? "Connect again" : "Connect Microsoft 365"} disabled={act.busy || !stored} testID="ms-connect" onPress={() => void connect()} /></Actions>
        {!stored ? <Para>Save the credentials in step 3 first.</Para> : null}
      </Step>
      <Step n={5} title="Grant admin consent" state={stateOf(4)}>
        <Para>A tenant admin opens this link, signs in, and chooses Accept. It grants the permissions from step 2 to the app.</Para>
        {link.data ? <OpenLink url={link.data.url} label="Open the admin consent page" testID="link-consent" /> : <Para>Connect in step 4 and the consent link appears here.</Para>}
      </Step>
      <Step n={6} title="Limit the app to the members you include" state={stateOf(5)}>
        <Para>Without this, the app could read any mailbox in your tenant. The first part runs in Exchange Online PowerShell and limits the app to the members below and no one else. The second part runs in Microsoft Teams PowerShell and lets the app read Teams transcripts of those members' meetings only. Run both as a tenant admin.</Para>
        <OpenLink url={MICROSOFT_LINKS.exchangePowerShell} label="How to connect to Exchange Online PowerShell" testID="link-powershell" />
        <OpenLink url={MICROSOFT_LINKS.teamsPowerShell} label="How to connect to Microsoft Teams PowerShell" testID="link-teams-powershell" />
        {snippet.data ? <CodeBlock value={snippet.data.snippet} testID="policy-snippet" /> : <Para>Connect in step 4 and the script appears here, filled in with your members.</Para>}
        <Actions><Button label={ranPolicy || s.policyConfirmed ? "Marked as done" : "I ran this"} disabled={!snippet.data || ranPolicy || s.policyConfirmed} testID="ms-policy-done" onPress={() => setRanPolicy(true)} /></Actions>
      </Step>
      <Step n={7} title="Check the connection" state={stateOf(6)}>
        <Para>Vyre signs in as the app, reads which permissions were granted, and tries one included member's mailbox. It names anything missing.</Para>
        <Actions><Button label="Check connection" disabled={act.busy || !configured} testID="ms-check" onPress={() => void verify()} /></Actions>
      </Step>
    </StepsCard>
  );

  return (
    <View testID="console-microsoft">
      <Banner
        summary={summary}
        right={configured ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button label="Check connection" disabled={act.busy} testID="ms-check-top" onPress={() => void verify()} />
            <Button label="Turn off" danger disabled={act.busy} testID="ms-off" onPress={() => setConfirmOff(true)} />
          </View>
        ) : undefined}
      />
      {confirmOff ? (
        <Section title="Turn off Microsoft 365?">
          <Para>Vyre stops syncing mail, calendars and files for every member. The credentials stay in the Vault. You can connect again at any time.</Para>
          <Actions>
            <Button label="Turn off" danger testID="ms-off-confirm" onPress={() => void off()} />
            <Button label="Keep it on" testID="ms-off-cancel" onPress={() => setConfirmOff(false)} />
          </Actions>
        </Section>
      ) : null}
      {act.note ? <Note>{act.note}</Note> : null}
      {problem ? <Note>{problem}</Note> : null}
      {configured ? <Services rows={rows} /> : null}
      <Section title={configured ? "Setup steps" : "Set up Microsoft 365"}>{steps}</Section>
      {!configured ? <Services rows={rows} /> : <><Members rows={memberRows} busy={act.busy} onToggle={(m) => void toggle(m)} onUnmatch={(m) => void unmatchPerson(act.run, "ms.consent.map_member", m.email)} /><Directory people={dir} picked={picked} links={links} busy={act.busy} onLoad={() => void loadDirectory()} onToggle={(email) => setPicked((cur) => { const next = new Set(cur); if (next.has(email)) next.delete(email); else next.add(email); return next; })} onInvite={() => void inviteChosen()} /><MatchPerson people={peopleOptions} domain={undefined} busy={act.busy} onMatch={(email, id) => void matchPerson(act.run, "ms.consent.map_member", email, id)} /></>}
    </View>
  );
}
