// Console > Integrations > Google Workspace: the guided admin setup for domain-wide delegation. Six numbered steps a non-technical admin can finish, each with the exact values to
// paste and a Copy button, then the service rows (healthy, degraded or not set up), then who is included. The service-account key goes to the Vault the moment it is pasted and is never
// drawn again; this page keeps only its public identity (client ID and service account address).
import { useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Section } from "../../shell/ui.tsx";
import { useConsoleData } from "../../shell/data.tsx";
import { Actions, Button, Field, Note, ReadState, useAction, useRead } from "../shared.tsx";
import { Banner, Bullets, CopyRow, Members, OpenLink, Para, PasteBox, Services, Step, StepsCard } from "./parts.tsx";
import type { StepState } from "./parts.tsx";
import { connectedLine, googleCheckLine, googleChecked, memberToggle, storeInVault } from "./flow.ts";
import type { Checked } from "./flow.ts";
import {
  GOOGLE_APIS, GOOGLE_HANDLE, GOOGLE_LINKS, GOOGLE_SCOPE_USE, domainOf, looksLikeEmail, parseGoogleKey, serviceRows, shortScope, summaryOf,
} from "./model.ts";
import type { GoogleKey, MemberRow } from "./model.ts";

type Status = CapMap["google.dwd.status"]["out"];

export function GoogleWorkspacePage(): ReactElement {
  const data = useConsoleData();
  const status = useRead<Status>("google.dwd.status", {});
  const configured = status.data?.configured === true;
  const scopes = useRead<CapMap["google.dwd.scopes"]["out"]>("google.dwd.scopes", {});
  const members = useRead<CapMap["google.dwd.members"]["out"]>("google.dwd.members", { limit: 100 }, { enabled: configured });
  const folders = useRead<CapMap["vault.folders.list"]["out"]>("vault.folders.list", { scope: "shared" });
  const items = useRead<CapMap["vault.items.list"]["out"]>("vault.items.list", { q: "Google_DWD", section: "shared" });
  const refresh = (): void => { status.refresh(); scopes.refresh(); members.refresh(); folders.refresh(); items.refresh(); };
  const act = useAction(refresh);

  const [pasted, setPasted] = useState("");
  const [problem, setProblem] = useState("");
  const [identity, setIdentity] = useState<GoogleKey | null>(null);
  const [admin, setAdmin] = useState("");
  const [checked, setChecked] = useState<Checked | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  if (!status.data) return <ReadState error={status.error} retry={status.refresh} />;
  const s = status.data;
  const stored = (items.data?.items ?? []).find((i) => i.handle === GOOGLE_HANDLE);
  const clientId = identity?.clientId ?? scopes.data?.clientId;
  const adminEmail = admin || s.adminEmail || "";
  const rows = serviceRows("google", { configured, checked, lastOk: s.lastProbeOk });
  const memberRows: MemberRow[] = (members.data?.members ?? []).map((m) => ({ email: m.email, userId: m.userId, mapped: m.mapped, excluded: m.excluded, mailboxState: m.mailboxState }));
  const included = memberRows.filter((m) => m.mapped && !m.excluded).length;
  const summary = summaryOf("google", rows, configured, included);

  const scopesOk = checked?.ok === true || s.lastProbeOk === true;
  const done = [Boolean(stored) || configured, Boolean(stored) || configured, scopesOk || configured, configured, checked?.ok === true || s.lastProbeOk === true];
  const firstOpen = done.findIndex((d) => !d);
  const stateOf = (i: number): StepState => (done[i] ? "done" : i === firstOpen ? "next" : "later");

  const saveKey = async (): Promise<void> => {
    const parsed = parseGoogleKey(pasted);
    if (!parsed.ok) { setProblem(parsed.problem); return; }
    setProblem("");
    const ok = await storeInVault(act.run, { name: "Google_DWD", handle: GOOGLE_HANDLE, text: pasted.trim(), folders: folders.data?.folders ?? [], existingItemId: stored?.id });
    if (ok) { setPasted(""); setIdentity(parsed.value); }
  };

  const connect = async (): Promise<void> => {
    if (!looksLikeEmail(adminEmail)) { setProblem("Type the email address of a Workspace admin, like admin@yourfirm.com."); return; }
    setProblem("");
    await act.run<CapMap["google.dwd.setup"]["out"]>("google.dwd.setup", { vaultItem: GOOGLE_HANDLE, adminEmail: adminEmail.trim(), idempotencyKey: "" }, (out) => connectedLine(out.mappedMembers, out.connected));
  };

  const check = async (): Promise<void> => {
    await act.run<CapMap["google.dwd.probe"]["out"]>("google.dwd.probe", {}, (out) => { setChecked(googleChecked(out)); return googleCheckLine(out, adminEmail); });
  };

  const toggle = (m: MemberRow): Promise<unknown> => memberToggle(act.run, "google.dwd.set_excluded", m);

  const off = async (): Promise<void> => {
    setConfirmOff(false);
    const out = await act.run("google.dwd.disable", {}, "Google Workspace is turned off. Syncing has stopped for every member.");
    if (out) setChecked(null);
  };

  const connectSteps = (
    <StepsCard>
      <Step n={1} title="Create a service account in Google Cloud" state={stateOf(0)}>
        <Para>You need to be a Google Cloud project owner. Use any project; a new one named Vyre keeps it tidy.</Para>
        <OpenLink url={GOOGLE_LINKS.serviceAccounts} label="Open Service accounts in Google Cloud" testID="link-service-accounts" />
        <Bullets items={["Choose Create service account, name it Vyre, and finish. It needs no project role.", "Open the new account, choose Keys, Add key, Create new key, JSON. A file downloads."]} />
        <Para>Then turn on these APIs in the same project:</Para>
        <Bullets items={[...GOOGLE_APIS]} />
        <OpenLink url={GOOGLE_LINKS.apiLibrary} label="Open the API library" testID="link-api-library" />
      </Step>
      <Step n={2} title="Add the key to the Vault" state={stateOf(1)}>
        {stored ? <Para>The key is in the Vault as {GOOGLE_HANDLE}. Paste a new file below only to replace it.</Para> : <Para>Open the downloaded file in any text editor, copy everything, and paste it here. The Vault keeps it; this page will never show it again.</Para>}
        <PasteBox label="Service-account key (JSON)" value={pasted} onChange={setPasted} testID="google-key" hint="Starts with { and contains private_key." />
        <Actions><Button label={stored ? "Replace key in the Vault" : "Save to the Vault"} disabled={act.busy || pasted.trim() === ""} testID="google-save-key" onPress={() => void saveKey()} /></Actions>
        {identity ? <Para>Recognised {identity.clientEmail}. The client ID is {identity.clientId}.</Para> : null}
      </Step>
      <Step n={3} title="Allow the scopes in Google Admin" state={stateOf(2)}>
        <Para>This is what lets the service account act for your people. You need to be a Workspace super admin.</Para>
        <OpenLink url={GOOGLE_LINKS.adminDelegation} label="Open Domain-wide delegation in Google Admin" testID="link-admin" />
        <Para>Choose Add new, then paste the client ID and the scopes.</Para>
        {clientId ? <CopyRow label="Client ID" value={clientId} testID="client-id" /> : <Para>Save the key in step 2 and the client ID appears here.</Para>}
        {scopes.data ? <CopyRow label="All scopes, one box (paste this)" value={scopes.data.scopes.join(",")} testID="scopes-all" /> : null}
        <View style={{ gap: 8 }}>
          {/* ui-rows-lint: not a list (values to copy inside a step, not list items) */}
          {(scopes.data?.scopes ?? []).map((sc) => <CopyRow key={sc} label={shortScope(sc)} value={sc} note={GOOGLE_SCOPE_USE[shortScope(sc)]} testID={`scope-${shortScope(sc)}`} />)}
        </View>
        <Para>Google can take a few minutes to apply the change.</Para>
      </Step>
      <Step n={4} title="Connect" state={stateOf(3)}>
        <Para>Type the email address of a Workspace admin. Vyre uses it for checks and matches your members by email on that address's domain.</Para>
        <Field label="Admin email" value={adminEmail} onChange={setAdmin} testID="google-admin-email" />
        {adminEmail && looksLikeEmail(adminEmail) ? <Para>Members with an address @{domainOf(adminEmail)} are matched.</Para> : null}
        <Actions><Button label={configured ? "Connect again" : "Connect Google Workspace"} disabled={act.busy || !stored} testID="google-connect" onPress={() => void connect()} /></Actions>
        {!stored ? <Para>Save the key in step 2 first.</Para> : null}
      </Step>
      <Step n={5} title="Check the connection" state={stateOf(4)}>
        <Para>Vyre asks Google for a sign-in for each scope and names any that are missing.</Para>
        <Actions><Button label="Check connection" disabled={act.busy || !configured} testID="google-check" onPress={() => void check()} /></Actions>
      </Step>
    </StepsCard>
  );

  return (
    <View testID="console-google">
      <Banner
        summary={summary}
        right={configured ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button label="Check connection" disabled={act.busy} testID="google-check-top" onPress={() => void check()} />
            <Button label="Turn off" danger disabled={act.busy} testID="google-off" onPress={() => setConfirmOff(true)} />
          </View>
        ) : undefined}
      />
      {confirmOff ? (
        <Section title="Turn off Google Workspace?">
          <Para>Vyre stops syncing mail, calendars and files for every member. The key stays in the Vault. You can connect again at any time.</Para>
          <Actions>
            <Button label="Turn off" danger testID="google-off-confirm" onPress={() => void off()} />
            <Button label="Keep it on" testID="google-off-cancel" onPress={() => setConfirmOff(false)} />
          </Actions>
        </Section>
      ) : null}
      {act.note ? <Note>{act.note}</Note> : null}
      {problem ? <Note>{problem}</Note> : null}
      {configured ? <Services rows={rows} /> : null}
      <Section title={configured ? "Setup steps" : "Set up Google Workspace"}>{connectSteps}</Section>
      {!configured ? <Services rows={rows} /> : <Members rows={memberRows} busy={act.busy} onToggle={(m) => void toggle(m)} />}
    </View>
  );
}

