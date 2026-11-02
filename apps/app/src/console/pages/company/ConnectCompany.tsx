// Connect your company: one screen that leads, a step at a time, for Google Workspace or Microsoft 365. It shows only what to do now, with a link to the right page at the provider, copy buttons and the section of the guide
// that explains it. A key goes straight from here to the Vault, is checked at once, and the next step waits for the check. company.status holds where this stands, so it resumes wherever it is opened; Assistant runs the same
// steps through the same capabilities.
import { useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createElement } from "react";
import { Linking, Platform, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { MarkdownBlocks, parseChunk } from "../../../../../../ui/src/stream/index.ts";
import type { StepId } from "../../../../../../lib/company-flow.ts";
import { useConsoleData } from "../../shell/data.tsx";
import { Group, Section } from "../../shell/ui.tsx";
import { Actions, Button, Field, Note, ReadState, pickRow, useAction, useRead } from "../shared.tsx";
import { saveSso } from "../sso-save.ts";
import { GOOGLE_HANDLE, GOOGLE_LINKS, MICROSOFT_HANDLE, MICROSOFT_LINKS, looksLikeEmail } from "../suite/model.ts";
import { Banner, Bullets, CodeBlock, CopyRow, Directory, Members, OpenLink, Para, PasteBox, Step, StepsCard } from "../suite/parts.tsx";
import type { DirPerson, Invited, StepState } from "../suite/parts.tsx";
import { memberToggle, storeInVault } from "../suite/flow.ts";
import { connectLine, dataLine, readPasted } from "./flow.ts";
import type { Provider } from "./flow.ts";

type Status = CapMap["company.status"]["out"];
type Data = { mail: boolean; calendar: boolean; files: boolean };

const CONSENT_SCREEN = "https://console.cloud.google.com/auth/branding";
const OAUTH_CLIENT = "https://console.cloud.google.com/auth/clients/create";
const withProject = (url: string, who: string | undefined): string => { const p = /@([^.]+)\.iam\.gserviceaccount\.com$/.exec(who ?? "")?.[1]; return p ? `${url}?project=${p}` : url; };

/** The guide for this step, opened in place. The words are the shipped doc itself, so the two cannot differ. */
function Guide({ provider, section }: { provider: Provider; section: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const guide = useRead<CapMap["company.guide"]["out"]>("company.guide", { provider, section }, { enabled: open });
  const text = guide.data?.text;
  return <View style={{ marginTop: 4 }}>
    <Text accessibilityRole="button" testID={`guide-${section}`} onPress={() => setOpen((v) => !v)} style={{ fontSize: 13, color: "var(--accent)" as string }}>{open ? "Hide the guide" : "Read the guide for this step"}</Text>
    {open && text ? <View style={{ marginTop: 8 }}><MarkdownBlocks blocks={parseChunk(text, 0)} /></View> : null}
    {open && guide.error ? <Note>The guide could not be opened. It is also in the docs folder of the release.</Note> : null}
  </View>;
}

/** A place to paste a key, or drop the file. On the web a dropped file reads straight into the box. */
function DropBox({ label, value, onChange, hint, testID }: { label: string; value: string; onChange: (v: string) => void; hint: string; testID: string }): ReactElement {
  const box = <PasteBox label={label} value={value} onChange={onChange} hint={hint} testID={testID} />;
  if (Platform.OS !== "web") return box;
  const style: CSSProperties = { display: "contents" };
  return createElement("div", { style, onDragOver: (e: { preventDefault(): void }) => e.preventDefault(), onDrop: (e: { preventDefault(): void; dataTransfer: { files: ArrayLike<{ text(): Promise<string> }> } }) => { e.preventDefault(); void e.dataTransfer.files[0]?.text().then(onChange); } }, box);
}

export function ConnectCompanyPage(): ReactElement {
  const data = useConsoleData();
  const status = useRead<Status>("company.status", {});
  const s = status.data;
  const act = useAction(status.refresh);
  if (!s) return <ReadState error={status.error} retry={status.refresh} />;
  if (!s.started) return <Choose onStart={(provider, d) => { void act.run("company.start", { provider, data: d }, "Started. Your place is saved here."); }} busy={act.busy} />;
  const provider = s.provider as Provider;
  const steps = s.steps ?? [];
  const stateOf = (id: string): StepState => (steps.find((x) => x.id === id)?.done ? "done" : s.next === id ? "next" : "later");
  const now = steps.find((x) => x.id === s.next);
  return <View testID="company-page">
    <Banner summary={s.connected ? { tone: "ok", title: `${s.title} is connected`, line: s.lastSweep ?? connectLine(s.mapped ?? 0, s.excluded?.length ?? 0, s.data!) } : { tone: "ok", title: `Connecting ${s.title}`, line: now ? `Next: ${now.title}.` : "Everything is ready." }} right={s.connected ? <Button label="Disconnect" danger disabled={act.busy} testID="company-disconnect" onPress={() => { void act.run("company.disconnect", {}, "Every sync has stopped. What already came in stays with its owner."); }} /> : undefined} />
    <StepsCard>
      {/* ui-rows-lint: not a list (numbered steps of one flow, each holding a form, not rows of things to open) */}
      {steps.map((step, i) => {
        const state = stateOf(step.id);
        const open = state === "next" || (step.id === "signin_require" && state !== "done" && steps.find((x) => x.id === "signin_try")?.done === true);
        return <Step key={step.id} n={i + 1} title={step.title} state={state} testID={`company-step-${step.id}`}>
          {open ? <><Body id={step.id as StepId} s={s} provider={provider} refresh={status.refresh} /><Guide provider={provider} section={step.doc} /></> : null}
        </Step>;
      })}
    </StepsCard>
    {act.note ? <Note>{act.note}</Note> : null}
    {s.connected ? <AccessLog /> : null}
    <Actions><Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>{data.space?.name ? `${dataLine(s.data!)} for ${data.space.name}.` : dataLine(s.data!)}</Text></Actions>
  </View>;
}

function Choose({ onStart, busy }: { onStart: (p: Provider, d: Data) => void; busy: boolean }): ReactElement {
  const [provider, setProvider] = useState<Provider>("google");
  const [d, setD] = useState<Data>({ mail: true, calendar: true, files: true });
  const flip = (k: keyof Data): void => setD({ ...d, [k]: !d[k] });
  return <View testID="company-choose">
    <Banner summary={{ tone: "ok", title: "Connect your company", line: "Space-wide sign-in, your people, and each person's mail, calendar and files, with nothing for them to sign in to." }} />
    <Section title="Which one do you use?"><Group>
      <Row {...pickRow({ id: "google", title: "Google Workspace", note: "About 15 minutes. A super admin does one step.", picked: provider === "google", onPress: () => setProvider("google") })} />
      <Row {...pickRow({ id: "microsoft", title: "Microsoft 365", note: "About 15 minutes. An Exchange admin does one step.", picked: provider === "microsoft", onPress: () => setProvider("microsoft") })} />
    </Group></Section>
    <Section title="What should come in?"><Group>
      <Row {...pickRow({ id: "mail", title: "Mail", note: "Each person's Inbox", picked: d.mail, onPress: () => flip("mail") })} />
      <Row {...pickRow({ id: "calendar", title: "Calendar", note: "Each person's calendar and meetings", picked: d.calendar, onPress: () => flip("calendar") })} />
      <Row {...pickRow({ id: "files", title: "Files", note: "Each person's Drive or OneDrive, in their Personal folder", picked: d.files, onPress: () => flip("files") })} />
    </Group></Section>
    <Actions><Button label="Start" disabled={busy || (!d.mail && !d.calendar && !d.files)} why={!d.mail && !d.calendar && !d.files ? "Choose at least one" : undefined} testID="company-start" onPress={() => onStart(provider, d)} /></Actions>
  </View>;
}

function Body(p: { id: StepId; s: Status; provider: Provider; refresh: () => void }): ReactElement | null {
  if (p.id === "access_key") return <KeyStep {...p} />;
  if (p.id === "access_allow") return p.provider === "google" ? <AllowGoogle {...p} /> : <AllowMicrosoft {...p} />;
  if (p.id === "access_limit") return <LimitStep {...p} />;
  if (p.id === "signin_app") return <SignInStep {...p} />;
  if (p.id === "signin_try") return <TryStep {...p} />;
  if (p.id === "signin_require") return <RequireStep {...p} />;
  if (p.id === "access_probe") return <ProbeStep {...p} />;
  if (p.id === "people") return <PeopleStep {...p} />;
  if (p.id === "confirm") return <ConfirmStep {...p} />;
  return null;
}

function KeyStep({ s, provider, refresh }: { s: Status; provider: Provider; refresh: () => void }): ReactElement {
  const script = useRead<CapMap["company.script"]["out"]>("company.script", { provider });
  const folders = useRead<CapMap["vault.folders.list"]["out"]>("vault.folders.list", { scope: "shared" });
  const name = provider === "google" ? "Google_DWD" : "Microsoft_App";
  // "space" lists every shared item, the person's own too: the key they pasted before is updated in place, never put twice (a second put of the same name is a duplicate)
  const items = useRead<CapMap["vault.items.list"]["out"]>("vault.items.list", { q: name, section: "space" });
  const act = useAction(() => { items.refresh(); folders.refresh(); refresh(); });
  const [text, setText] = useState("");
  const [hand, setHand] = useState({ tenantId: "", clientId: "", clientSecret: "" });
  const [problem, setProblem] = useState("");
  const save = async (): Promise<void> => {
    setProblem("");
    const read = readPasted(provider, text, hand);
    if (!read.ok) { setProblem(read.problem); return; }
    const handle = provider === "google" ? GOOGLE_HANDLE : MICROSOFT_HANDLE;
    // a client secret lasts at most 24 months: the Vault reminds someone at 20. A certificate from the script is good for two years and rotates the same way.
    const stored = await storeInVault(act.run, { name, handle, text: read.value.text, folders: folders.data?.folders ?? [], existingItemId: (items.data?.items ?? []).find((i) => i.handle === handle)?.id, ...(provider === "microsoft" ? { rotateEveryDays: 600 } : {}) });
    if (!stored) return;
    setText(""); setHand({ tenantId: "", clientId: "", clientSecret: "" });
    const out = await act.run<CapMap["company.check"]["out"]>("company.check", {}, (o) => (o.ok ? `That works. ${o.who ?? "The app signed in"}.` : ""));
    if (out && !out.ok) setProblem(out.problem ?? "That did not work.");
    refresh();
  };
  return <>
    {script.data ? <><Para>The fast way: open {script.data.shell}, paste this, press Enter.</Para><OpenLink url={script.data.url} label={`Open ${script.data.shell}`} testID="company-shell" /><CodeBlock value={script.data.script} testID="company-script" /></> : null}
    {provider === "google"
      ? <DropBox label="Drop vyre-key.json here, or paste it" value={text} onChange={setText} hint="Goes straight to the Vault. It is never shown again, and no agent can read it." testID="company-key" />
      : <><DropBox label="Paste the line the script printed" value={text} onChange={setText} hint="Goes straight to the Vault. It is never shown again, and no agent can read it." testID="company-key" />
          <Para>Or register the app by hand and fill these in.</Para><OpenLink url={MICROSOFT_LINKS.appRegistrations} label="Open App registrations in Entra" testID="company-entra" />
          {s.redirect ? <CopyRow label="Redirect URI" value={s.redirect} testID="company-redirect" /> : null}
          <Field label="Directory (tenant) ID" value={hand.tenantId} onChange={(v) => setHand({ ...hand, tenantId: v })} testID="company-tenant" />
          <Field label="Application (client) ID" value={hand.clientId} onChange={(v) => setHand({ ...hand, clientId: v })} testID="company-client" />
          <Field label="Client secret Value" secure value={hand.clientSecret} onChange={(v) => setHand({ ...hand, clientSecret: v })} testID="company-secret" /></>}
    {problem ? <Note>{problem}</Note> : null}
    {act.note && !problem ? <Note>{act.note}</Note> : null}
    <Actions><Button label="Save and check" disabled={act.busy || (!text.trim() && !hand.clientSecret.trim())} why={!text.trim() && !hand.clientSecret.trim() ? "Paste it first" : undefined} testID="company-save-key" onPress={() => void save()} /></Actions>
  </>;
}

function AllowGoogle({ s, refresh }: { s: Status; refresh: () => void }): ReactElement {
  const scopes = useRead<CapMap["google.dwd.scopes"]["out"]>("google.dwd.scopes", {});
  const act = useAction(refresh);
  const [admin, setAdmin] = useState("");
  const [problem, setProblem] = useState("");
  const wanted = scopes.data?.scopes ?? [];
  const check = async (): Promise<void> => {
    if (!looksLikeEmail(admin)) { setProblem("Type the address of a Workspace admin, like admin@yourfirm.com."); return; }
    setProblem("");
    await act.run("google.dwd.setup", { vaultItem: GOOGLE_HANDLE, adminEmail: admin.trim(), data: s.data, hold: true, idempotencyKey: "" }, "Google accepted it.");
    refresh();
  };
  return <>
    <Para>A super admin does this once. Press Add new on the Google page, then copy these two in.</Para>
    <OpenLink url={GOOGLE_LINKS.adminDelegation} label="Open Google Admin" testID="company-admin" />
    {s.clientId ? <CopyRow label="Client ID" value={s.clientId} testID="company-client-id" /> : null}
    {wanted.length ? <CopyRow label="Scopes, as one line" value={wanted.join(",")} testID="company-scopes" /> : null}
    <Bullets items={wanted.map((x) => x.slice(x.lastIndexOf("/") + 1))} />
    <Field label="A Workspace admin's address" value={admin} onChange={setAdmin} testID="company-admin-email" />
    <Note>Vyre only signs in as this address to check the setup. Nobody's Inbox gets its mail.</Note>
    {problem ? <Note>{problem}</Note> : null}
    {act.note ? <Note>{act.note}</Note> : null}
    <Actions><Button label="Check" disabled={act.busy} testID="company-allow-check" onPress={() => void check()} /></Actions>
    <Note>Google can take up to 24 hours to apply this, usually minutes. You can leave and come back.</Note>
  </>;
}

function AllowMicrosoft({ s, refresh }: { s: Status; refresh: () => void }): ReactElement {
  const configured = s.clientId !== undefined && s.steps?.some((x) => x.id === "access_key" && x.done) === true;
  const app = useRead<CapMap["ms.consent.status"]["out"]>("ms.consent.status", {});
  const link = useRead<CapMap["ms.consent.link"]["out"]>("ms.consent.link", {}, { enabled: app.data?.configured === true });
  const act = useAction(refresh);
  const [domain, setDomain] = useState("");
  const set = async (): Promise<void> => {
    const out = await act.run<CapMap["company.check"]["out"]>("company.check", {}, "");
    if (!out?.tenantId) return;
    await act.run("ms.consent.setup", { vaultItem: MICROSOFT_HANDLE, tenantId: out.tenantId, ...(domain.trim() ? { domain: domain.trim().toLowerCase() } : {}), data: s.data, hold: true, idempotencyKey: "" }, "The app is connected. Now grant consent.");
    app.refresh();
  };
  const verify = async (): Promise<void> => { await act.run("ms.consent.verify", {}, "Consent is given."); refresh(); };
  return <>
    {app.data?.configured !== true && configured ? <>
      <Field label="Your domain, like yourfirm.com" value={domain} onChange={setDomain} testID="company-domain" />
      <Actions><Button label="Continue" disabled={act.busy} testID="company-ms-setup" onPress={() => void set()} /></Actions>
    </> : null}
    {link.data ? <><Para>Open this as an admin and press Accept.</Para><OpenLink url={link.data.url} label="Open the consent page" testID="company-consent" /><Bullets items={link.data.permissions} /><Actions><Button label="Check" disabled={act.busy} testID="company-consent-check" onPress={() => void verify()} /></Actions></> : null}
    {act.note ? <Note>{act.note}</Note> : null}
  </>;
}

function LimitStep({ s, refresh }: { s: Status; refresh: () => void }): ReactElement {
  const snippet = useRead<CapMap["ms.consent.policy_snippet"]["out"]>("ms.consent.policy_snippet", {});
  const act = useAction(refresh);
  return <>
    <Para>An Exchange admin pastes this into Exchange Online PowerShell. It limits the app to your members' mailboxes, at Microsoft.</Para>
    <OpenLink url={MICROSOFT_LINKS.exchangePowerShell} label="How to open Exchange Online PowerShell" testID="company-exchange" />
    {snippet.data ? <CodeBlock value={snippet.data.snippet} testID="company-snippet" /> : null}
    {act.note ? <Note>{act.note}</Note> : null}
    <Actions><Button label="I ran it" disabled={act.busy} testID="company-limit-done" onPress={() => { void act.run("ms.consent.verify", { policyConfirmed: true }, (o: { ok?: boolean; detail?: string }) => o.detail ?? "Microsoft answered."); }} /></Actions>
    {s.data?.files ? <Note>Files has no such limit at Microsoft. Vyre enforces the person on every call.</Note> : null}
  </>;
}

function SignInStep({ s, provider, refresh }: { s: Status; provider: Provider; refresh: () => void }): ReactElement {
  const data = useConsoleData();
  const saved = useRead<CapMap["members.sso.list"]["out"]>("members.sso.list", {});
  const act = useAction(refresh);
  const have = saved.data?.providers.find((p) => p.key === provider);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [domain, setDomain] = useState("");
  const [note, setNote] = useState("");
  const save = async (): Promise<void> => {
    const hint = (domain || have?.domainHint || "").trim().toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hint)) { setNote("Type your domain, like yourfirm.com. Without it nobody can sign in."); return; }
    // Microsoft: the app you registered is the sign-in app, so its secret is already in the Vault under the same handle
    const r = provider === "google" ? await saveSso(data.call, { key: provider, clientId: clientId || have?.clientId || "", secret, domain: hint, tenant: "", enabled: true }, have)
      : await data.call("members.sso.set", { provider: { key: "microsoft", title: "Microsoft", issuer: `https://login.microsoftonline.com/${s.tenant ?? ""}/v2.0`, clientId: s.clientId ?? "", clientSecretHandle: MICROSOFT_HANDLE, enabled: true, domainHint: hint } }).then(() => ({ ok: true as const, message: "Microsoft sign-in saved" }), (e: { message?: string }) => ({ ok: false as const, message: e.message ?? "Couldn't save this." }));
    setNote(r.message); setSecret("");
    if (r.ok) { const t = await data.call("members.sso.test", { key: provider }) as { ok: boolean; detail?: string }; setNote(t.ok ? "Saved. The provider answered." : t.detail ?? "Saved, but the provider did not answer."); refresh(); }
  };
  return <>
    {provider === "google" ? <><Para>Sign-in is a small app in the project you just made. Set it to Internal, so only your people can use it.</Para>
      <OpenLink url={withProject(CONSENT_SCREEN, s.who)} label="Open Branding in Google Cloud" testID="company-branding" />
      <OpenLink url={withProject(OAUTH_CLIENT, s.who)} label="Create the client" testID="company-oauth" />
      {s.redirect ? <CopyRow label="Authorized redirect URI" value={s.redirect} testID="company-redirect" /> : null}
      <Field label="Client ID" value={clientId} onChange={setClientId} testID="company-signin-client" />
      <Field label="Client secret" secure value={secret} onChange={setSecret} testID="company-signin-secret" /></> : <Para>The app you registered also does sign-in. Say which domain it is for.</Para>}
    <Field label="Your domain, like yourfirm.com" value={domain || have?.domainHint || ""} onChange={setDomain} testID="company-signin-domain" />
    {note ? <Note>{note}</Note> : null}
    <Actions><Button label="Turn on sign-in" disabled={act.busy} testID="company-signin-save" onPress={() => void save()} /></Actions>
  </>;
}

function TryStep({ s, provider, refresh }: { s: Status; provider: Provider; refresh: () => void }): ReactElement {
  const data = useConsoleData();
  const [line, setLine] = useState("");
  const go = async (): Promise<void> => {
    const out = await data.call("identity.sso_link", { provider }) as { start: string };
    void Linking.openURL(`${s.space ?? (globalThis as { location?: { origin?: string } }).location?.origin ?? ""}${out.start}`);
    setLine("Finish in the window that opened, then press Done.");
  };
  return <>
    <Para>The Space owner signs in once. This proves it works, requiring it later can never lock them out, and it brings in your own mail and calendar.</Para>
    {line ? <Note>{line}</Note> : null}
    <Actions><Button label={`Sign in with ${provider === "google" ? "Google" : "Microsoft"} once`} testID="company-try" onPress={() => void go()} /><Button label="Done" testID="company-try-done" onPress={refresh} /></Actions>
  </>;
}

function RequireStep({ s, provider, refresh }: { s: Status; provider: Provider; refresh: () => void }): ReactElement {
  const policy = useRead<CapMap["members.sign_in_policy.get"]["out"]>("members.sign_in_policy.get", {});
  const act = useAction(refresh);
  const blocked = s.signInTried !== true ? "The owner has to sign in once first." : s.recoveryKey !== true ? "The owner has to save a recovery key first. Open Sign-in and devices." : undefined;
  return <>
    <Para>Optional. Passwords stop working. If {provider === "google" ? "Google" : "Microsoft"} is ever down, the owner signs in with their recovery key, and nobody else can get around it.</Para>
    {act.note ? <Note>{act.note}</Note> : null}
    <Actions><Button label="Everyone must use it" disabled={act.busy || !!blocked || !policy.data} why={blocked} testID="company-require" onPress={() => { void act.run("members.sign_in_policy.set", { policy: { ...policy.data!.policy, requireSso: true, allowPassword: false } }, "Everyone signs in this way now."); }} /></Actions>
  </>;
}

function ProbeStep({ refresh }: { refresh: () => void }): ReactElement {
  const act = useAction(refresh);
  const [line, setLine] = useState("");
  return <>
    <Para>This asks the provider whether it will answer. It reads nobody's mail.</Para>
    {line ? <Note>{line}</Note> : null}
    <Actions><Button label="Run the check" disabled={act.busy} testID="company-probe" onPress={() => { void act.run<CapMap["company.probe"]["out"]>("company.probe", {}, (o) => { setLine(o.line); return ""; }); }} /></Actions>
  </>;
}

function PeopleStep({ provider, refresh }: { s: Status; provider: Provider; refresh: () => void }): ReactElement {
  const google = provider === "google";
  const members = useRead<{ members: { email: string; userId?: string; mapped: boolean; excluded: boolean; mailboxState?: string }[] }>(google ? "google.dwd.members" : "ms.consent.members", { limit: 100 });
  const act = useAction(() => { members.refresh(); refresh(); });
  const [dir, setDir] = useState<DirPerson[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [links, setLinks] = useState<Invited[]>([]);
  const load = (): void => { void act.run<{ people: DirPerson[] }>(google ? "google.directory.list" : "ms.directory.list", {}, (o) => { setDir(o.people); return `${o.people.length} ${o.people.length === 1 ? "person" : "people"} in your directory.`; }); };
  const invite = (): void => { void act.run<{ invited: Invited[]; skipped: { email: string; reason: string }[] }>(google ? "google.directory.import" : "ms.directory.import", { people: [...picked].map((email) => ({ email, role: "rol_member" })), idempotencyKey: "" }, (o) => { setLinks(o.invited); setPicked(new Set()); return `${o.invited.length} invited.`; }); };
  return <>
    <Members rows={members.data?.members ?? []} busy={act.busy} onToggle={(m) => { void memberToggle(act.run, google ? "google.dwd.set_excluded" : "ms.consent.set_excluded", m); }} />
    <Directory people={dir} picked={picked} links={links} busy={act.busy} onLoad={load} onToggle={(e) => setPicked((p) => { const n = new Set(p); if (!n.delete(e)) n.add(e); return n; })} onInvite={invite} />
    {act.note ? <Note>{act.note}</Note> : null}
    <Actions><Button label="This is everyone" testID="company-people-done" onPress={() => { void act.run("company.people_done", {}, ""); }} /></Actions>
  </>;
}

function ConfirmStep({ s, refresh }: { s: Status; refresh: () => void }): ReactElement {
  const act = useAction(refresh);
  return <>
    <Para>{connectLine(s.mapped ?? 0, s.excluded?.length ?? 0, s.data!)}</Para>
    {s.probeLine ? <Note>{s.probeLine}</Note> : null}
    {act.note ? <Note>{act.note}</Note> : null}
    <Actions><Button label="Connect" disabled={act.busy} testID="company-connect" onPress={() => { void act.run("company.connect", { idempotencyKey: "" }, "Connected. Inboxes and calendars start filling within minutes."); }} /></Actions>
  </>;
}

function AccessLog(): ReactNode {
  const log = useRead<CapMap["company.access_log"]["out"]>("company.access_log", { limit: 20 });
  const rows = log.data?.entries ?? [];
  if (rows.length === 0) return null;
  return <Section title="Access log" testID="company-log"><Group>
    {rows.map((r) => <Row key={`${r.at}${r.who}${r.cap}`} id={`${r.at}${r.who}${r.cap}`} title={r.mailbox} note={`${r.who}${r.onBehalf ? ` for ${r.onBehalf}` : ""}, ${r.cap}`} />)}
  </Group></Section>;
}
