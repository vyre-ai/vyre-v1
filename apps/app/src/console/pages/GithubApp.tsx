// Console > Apps > GitHub: the Space can use its own GitHub app instead of the Vyre one. Admins only (connectors.manage).
// Reads members.sign_in_github.get (client id, whether the secret is set, the callback), github.app.get (the app, when there is one), github.installations.list and ci.settings.get (does the app need new permissions).
// Writes members.sign_in_github.set and .clear (the values and going back to the Vyre app), github.app.create_manifest (Create one for us) and github.app.complete (when GitHub sends the person back).
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Glyph } from "../shell/glyphs.tsx";
import { Group, Lead, Line, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Switch } from "../../places/settings/ui.tsx";
import { LogoTile } from "../../places/vault/layout/parts.tsx";
import { GithubAppLine, IconTile } from "./CiRunners.tsx";
import type { CiSettings } from "./CiRunners.tsx";
import { Actions, Button, Field, FormSheet, Note, ReadState, useAction, useRead } from "./shared.tsx";

type Sign = CapMap["members.sign_in_github.get"]["out"]["github"];
type App = CapMap["github.app.get"]["out"];
type Installs = CapMap["github.installations.list"]["out"]["installations"];

const GITHUB = "https://github.com";
const open = (url: string): void => { (globalThis as { open?: (u: string, t: string, f: string) => unknown }).open?.(url, "_blank", "noopener,noreferrer"); };

/** Is the app usable: GitHub made it for this Space, or the client id and secret are saved. */
export const appComplete = (sign: Sign, app: App | null): boolean => app !== null || (Boolean(sign.clientId) && sign.secretSet);
/** The one line under the switch. */
export function ownLine(on: boolean, complete: boolean, spaceName: string): string {
  if (!on) return "Off. Members use the Vyre GitHub app";
  return complete ? `Members sign in and connect GitHub through ${spaceName}'s app` : "Not working yet. Add the values below or create the app for us";
}
/** Where to install the app, and where to change an install that exists. */
export const installUrl = (slug: string): string => `${GITHUB}/apps/${encodeURIComponent(slug)}/installations/new`;
export const changeUrl = (id: number): string => `${GITHUB}/settings/installations/${id}`;
/** The code and state GitHub puts in the address when it sends the person back after they confirm the app. */
export function manifestReturn(search: string): { code: string; state: string } | null {
  const p = new URLSearchParams(search);
  const code = p.get("code"), state = p.get("state");
  return code && state ? { code, state } : null;
}
/** Sends the manifest to GitHub the way GitHub asks: a form post that opens the confirm page. Without a page to post from, it opens the address. */
export function postManifest(out: { manifest: unknown; postUrl: string }): void {
  const doc = (globalThis as { document?: { createElement(t: string): Record<string, unknown> & { appendChild(c: unknown): void; submit(): void }; body?: { appendChild(c: unknown): void } } }).document;
  if (!doc?.body || typeof doc.createElement("form").submit !== "function") { open(out.postUrl); return; }
  const form = doc.createElement("form"), input = doc.createElement("input");
  Object.assign(form, { method: "post", action: out.postUrl, target: "_blank" });
  Object.assign(input, { type: "hidden", name: "manifest", value: JSON.stringify(out.manifest) });
  form.appendChild(input); doc.body.appendChild(form); form.submit();
}

/** The helper line under a card: 12px, muted, with a gap above and the section gap below. */
function Foot({ children, top = 8, testID = "gh-foot" }: { children: string; top?: number; testID?: string }): ReactElement {
  return <Text accessibilityRole="status" testID={testID} style={{ fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string, marginTop: top, paddingHorizontal: 2 }}>{children}</Text>;
}
/** An App details value: always muted. A value that is missing says "Not set". */
export const valueWord = (value: string | number | null | undefined): string => value === null || value === undefined || value === "" ? "Not set" : String(value);
/** A secret never shows: "Set in Vault" when it is saved there, "Not set" when it is not. */
export const secretWord = (isSet: boolean): string => isSet ? "Set in Vault" : "Not set";
const Value = ({ children }: { children: string }): ReactElement => <Text style={{ fontSize: 13, color: "var(--ink-3)" as string }}>{children}</Text>;
const GhMark = (): ReactElement => <Lead><LogoTile name="github" size={30} /></Lead>;

export function GithubAppPage(): ReactElement {
  const data = useConsoleData();
  const sign = useRead<{ github: Sign }>("members.sign_in_github.get");
  const ci = useRead<CiSettings>("ci.settings.get");
  const [app, setApp] = useState<App | null>(null);
  const [installs, setInstalls] = useState<Installs>([]);
  const [rev, setRev] = useState(0);
  const [wantOwn, setWantOwn] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [sheet, setSheet] = useState<"keys" | "create" | null>(null);
  const refresh = (): void => { sign.refresh(); ci.refresh(); setRev((n) => n + 1); };
  const action = useAction(refresh);
  // GitHub sends the person back with a code once they confirm the app: finish it here, once
  useEffect(() => {
    const back = manifestReturn((globalThis as { location?: { search?: string } }).location?.search ?? "");
    if (back) void action.run("github.app.complete", { ...back, idempotencyKey: back.state }, "Your GitHub app is ready");
  }, []);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const a = await data.call("github.app.get", {}) as App;
        const i = await data.call("github.installations.list", {}) as { installations: Installs };
        if (live) { setApp(a); setInstalls(i.installations); }
      } catch { if (live) { setApp(null); setInstalls([]); } }
    })();
    return () => { live = false; };
  }, [rev]);
  if (!sign.data) return <ReadState error={sign.error} retry={sign.refresh} />;
  const g = sign.data.github;
  const complete = appComplete(g, app);
  const on = wantOwn || complete || g.source === "space";
  const flip = (next: boolean): void => {
    if (next) { setWantOwn(true); return; }
    if (complete) { setConfirm(true); return; }
    setWantOwn(false);
  };
  return <View testID="console-github-app">
    <Section title="GitHub app">
      <Group>
        <Row id="gh-own" title="Use our own GitHub app" note={ownLine(on, complete, data.space.name)} leading={<GhMark />} trailing={<Switch on={on} label="Use our own GitHub app" testID="gh-own-switch" disabled={action.busy} onChange={flip} />} />
        {confirm ? <View testID="gh-off-confirm" style={{ padding: 12, gap: 10 }}>
          <Text style={{ fontSize: 13, color: "var(--ink)" as string }}>Go back to the Vyre GitHub app? Members connect GitHub once more. Their repos and permissions stay.</Text>
          <Actions><Button label="Switch back" testID="gh-off-yes" disabled={action.busy} onPress={() => void action.run("members.sign_in_github.clear", {}, "Members use the Vyre GitHub app").then(() => { setConfirm(false); setWantOwn(false); })} /><Button label="Cancel" testID="gh-off-cancel" onPress={() => setConfirm(false)} /></Actions>
        </View> : null}
      </Group>
      {on ? null : <Foot top={14} testID="gh-foot-off">The Vyre GitHub app needs nothing from you. Switch to your own app if your GitHub org requires it, or you want its name on the permission screen.</Foot>}
    </Section>
    {on ? <>
      <Section title="App details">
        <Group>
          <Line index={0}><Row id="gh-app-id" title="App id" leading={<IconTile icon="key2" />} note={app ? "Vault: GITHUB_APP_ID" : "Not set"} trailing={<Value>{valueWord(app?.id)}</Value>} /></Line>
          <Line index={1}><Row id="gh-app-key" title="Private key" leading={<IconTile icon="key2" />} note={app ? "Vault: GITHUB_APP_PRIVATE_KEY" : "Not set"} trailing={<Value>{secretWord(Boolean(app))}</Value>} /></Line>
          <Line index={2}><Row id="gh-client-id" title="Client id" leading={<IconTile icon="key2" />} note={g.clientId ? "Saved" : "Not set"} trailing={<Value>{valueWord(g.clientId)}</Value>} /></Line>
          <Line index={3}><Row id="gh-client-secret" title="Client secret" leading={<IconTile icon="key2" />} note={g.secretSet || app ? "Vault: GITHUB_APP_CLIENT_SECRET" : "Not set"} trailing={<Value>{secretWord(Boolean(g.secretSet || app))}</Value>} /></Line>
        </Group>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {app ? null : <Button small label="Create one for us" testID="gh-create" onPress={() => setSheet("create")} />}
          <Button small label={g.secretSet ? "Change client id and secret" : "Use an app we already made"} testID="gh-keys" onPress={() => setSheet("keys")} />
        </View>
        <Foot>{app ? "Created for this Space. The keys are in Vault." : "Create one opens GitHub, which asks you to confirm the app. The keys go straight into Vault."}</Foot>
      </Section>
      <Section title="The Space's installation">
        <Group>
          {installs.length === 0 ? <Row id="gh-no-install" title="Not installed" note="Install the app on your GitHub org so CI and Space crews can reach its repos" leading={<GhMark />} trailing={app ? <Button small label="Install" testID="gh-install" onPress={() => open(installUrl(app.slug))} /> : undefined} /> : null}
          {installs.map((i, n) => <Line key={i.id} index={n}><Row id={`gh-install-${i.id}`} title={i.account} note={`${i.repositorySelection === "all" ? "All repositories" : "Selected repositories"}. CI and Space crews use it`} leading={<GhMark />} trailing={<Button small label="Change" testID={`gh-change-${i.id}`} onPress={() => open(changeUrl(i.id))} />} /></Line>)}
        </Group>
        <Foot top={14} testID="gh-foot-own">{`${data.space.name} uses its own GitHub app. Reconnect once.`}</Foot>
        {app ? <View style={{ marginTop: 12, flexDirection: "row" }}><Button small label="Check again" testID="gh-recheck" disabled={action.busy} onPress={() => void action.run("github.installations.list", {}, "Checked").then((out) => { if (out) refresh(); })} /></View> : null}
      </Section>
      {ci.data ? <GithubAppLine settings={ci.data} /> : null}
    </> : null}
    {action.note ? <Note>{action.note}</Note> : null}
    {sheet === "keys" ? <KeysSheet sign={g} onClose={() => setSheet(null)} onDone={() => { setSheet(null); refresh(); }} /> : null}
    {sheet === "create" ? <CreateSheet callback={g.callbackUrl} onClose={() => setSheet(null)} onDone={refresh} /> : null}
  </View>;
}

/** Save the client id and secret of an app that already exists. The secret goes to the Vault and is never shown again. */
function KeysSheet({ sign, onClose, onDone }: { sign: Sign; onClose: () => void; onDone: () => void }): ReactElement {
  const action = useAction(onDone);
  const [clientId, setClientId] = useState(sign.clientId ?? "");
  const [secret, setSecret] = useState("");
  const ready = clientId.trim() !== "" && (secret.trim() !== "" || sign.secretSet);
  return <FormSheet title="Use an app we already made" onClose={onClose} submit="Save" disabled={!ready || action.busy} why={clientId.trim() === "" ? "Add the client id" : !ready ? "Add the client secret" : undefined} note={action.note}
    onSubmit={() => void action.run("members.sign_in_github.set", { clientId: clientId.trim(), ...(secret.trim() ? { clientSecret: secret.trim() } : {}) }, "GitHub app saved")} testID="gh-keys-sheet">
    <Text style={{ fontSize: 13, color: "var(--ink-3)" as string }}>{`Register ${sign.callbackUrl} as the callback at GitHub, then paste the client id and a new secret. The secret goes to Vault.`}</Text>
    <Field label="Client id" value={clientId} onChange={setClientId} testID="gh-field-id" />
    <Field label={sign.secretSet ? "New client secret (leave empty to keep the saved one)" : "Client secret"} value={secret} onChange={setSecret} secure testID="gh-field-secret" />
  </FormSheet>;
}

/** Create the app on GitHub: say which GitHub org, press the button, GitHub asks to confirm, then the keys land in Vault. */
function CreateSheet({ callback, onClose, onDone }: { callback: string; onClose: () => void; onDone: () => void }): ReactElement {
  const data = useConsoleData();
  const action = useAction(onDone);
  const [org, setOrg] = useState("");
  const [name, setName] = useState(`${data.space.name} Vyre`);
  const [sent, setSent] = useState(false);
  const go = async (): Promise<void> => {
    const out = await action.run<{ manifest: unknown; postUrl: string; state: string }>("github.app.create_manifest", { org: org.trim(), ...(name.trim() ? { name: name.trim() } : {}) }, "GitHub is waiting for you to confirm the app");
    if (out) { postManifest(out); setSent(true); }
  };
  if (sent) return <FormSheet title="Confirm the app on GitHub" onClose={onClose} submit="Check again" onSubmit={onDone} testID="gh-create-sheet">
    <Text style={{ fontSize: 13, color: "var(--ink-3)" as string }}>GitHub shows the app Vyre is asking for. Check it, then confirm. The app id, private key and client secret go straight into Vault, and this page shows them when it is done.</Text>
  </FormSheet>;
  return <FormSheet title="Create the app on GitHub" onClose={onClose} submit="Create GitHub App" disabled={org.trim() === "" || action.busy} why={org.trim() === "" ? "Add the GitHub organization" : undefined} note={action.note} onSubmit={() => void go()} testID="gh-create-sheet">
    <Text style={{ fontSize: 13, color: "var(--ink-3)" as string }}>GitHub shows the app Vyre is asking for. Check it, then confirm.</Text>
    <Field label="GitHub organization" value={org} onChange={setOrg} testID="gh-field-org" />
    <Field label="App name" value={name} onChange={setName} testID="gh-field-name" />
    <Group>
      <Row id="gh-create-callback" title="Sign-in callback" note={callback} />
      <Row id="gh-create-perms" title="Permissions" note="Contents, Pull requests, Issues, Checks, Actions, Secrets and runners" />
    </Group>
  </FormSheet>;
}
