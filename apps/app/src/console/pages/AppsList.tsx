// Console > Apps > Connected apps: one list. Each app is a row with its name, what it does, and either Connect or Connected with Manage. The rows come from what the Connectors and Connections pages
// read (connectors.list, connections.list) and from the two company sign-in setups (Google Workspace, Microsoft 365), whose Manage opens their own setup page. Connect starts the sign-in for an app;
// Manage lists the people who signed in to it and Disconnect stops it for the Space. A sign-in that matches no app sits under Other sign-ins.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Lead, Section, StatusLabel } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Actions, Button, Note, ReadState, useAction, useRead } from "./shared.tsx";
import { useIntegrationRows } from "./integration-data.ts";
import { ConnectionObject, NewConnection } from "./Connections.tsx";
import { ConnectorObject, NewConnector } from "./Connectors.tsx";

type Connector = CapMap["connectors.get"]["out"]["connector"];
type Connection = CapMap["connections.get"]["out"]["connection"];
type AppView = { kind: "list" } | { kind: "app"; key: string } | { kind: "connect"; key: string } | { kind: "connection"; id: string; from: string } | { kind: "settings"; key: string } | { kind: "newapp" };

const HOW: Readonly<Record<string, string>> = { api: "an API key", mcp: "an MCP server", dwd: "domain-wide delegation", oauth_app: "an OAuth sign-in", webhook_only: "incoming webhooks" };
/** What an app does, in a few plain words: the record types it syncs, else how it connects. */
export function whatItDoes(c: Pick<Connector, "mode" | "syncedTypes">): string {
  if (c.syncedTypes.length) return `Syncs ${c.syncedTypes.slice(0, 3).join(", ")}${c.syncedTypes.length > 3 ? " and more" : ""}`;
  return HOW[c.mode] ? `Connects with ${HOW[c.mode]}` : "Connects to your Space";
}

/** Goes back to the list once: the page an app stood on is gone (a custom app was removed). */
function GoBack({ to }: { to: () => void }): null { useEffect(() => { to(); }, []); return null; } // eslint-disable-line react-hooks/exhaustive-deps

/** The connections that belong to no app on the list. */
export function otherSignIns<C extends { connector: string }>(connections: readonly C[], apps: readonly { key: string }[]): C[] {
  const keys = new Set(apps.map((a) => a.key));
  return connections.filter((c) => !keys.has(c.connector));
}

function Logo({ name }: { name: string }): ReactElement {
  return (
    <Lead>
      <View style={{ width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: "var(--ink-2)" as string }}>{name.slice(0, 1).toUpperCase()}</Text>
      </View>
    </Lead>
  );
}

export function AppsPage(): ReactElement {
  const data = useConsoleData();
  const connectors = useIntegrationRows<Connector>("connectors.list", "connectors");
  const connections = useIntegrationRows<Connection>("connections.list", "connections", { whose: "all" });
  const google = useRead<CapMap["google.dwd.status"]["out"]>("google.dwd.status", {});
  const microsoft = useRead<CapMap["ms.consent.status"]["out"]>("ms.consent.status", {});
  const [view, setView] = useState<AppView>({ kind: "list" });
  const [confirm, setConfirm] = useState("");
  const refresh = (): void => { connectors.refresh(); connections.refresh(); google.refresh(); microsoft.refresh(); };
  const action = useAction(refresh);
  const home = (): void => { setView({ kind: "list" }); setConfirm(""); refresh(); };

  if (view.kind === "newapp") return <NewConnector onBack={home} onCreated={(key) => setView({ kind: "settings", key })} />;
  if (view.kind === "settings") return <ConnectorObject key={view.key} id={view.key} onBack={() => { refresh(); setView({ kind: "app", key: view.key }); }} />;
  if (view.kind === "connect") return <NewConnection initialKey={view.key} onBack={() => { setView({ kind: "app", key: view.key }); refresh(); }} onCreated={(id) => setView({ kind: "connection", id, from: view.key })} />;
  if (view.kind === "connection") return <ConnectionObject key={view.id} id={view.id} onBack={() => { refresh(); setView(view.from ? { kind: "app", key: view.from } : { kind: "list" }); }} />;

  if (!connectors.ready || !connections.ready) return <ReadState error={connectors.error ?? connections.error} retry={refresh} />;

  // a custom app stays on the list while it is a draft, so a person can come back to finish and publish it
  const apps = connectors.rows.filter((c) => c.state === "live" || c.connections > 0 || !c.builtin);
  const signIns = (key: string): Connection[] => connections.rows.filter((c) => c.connector === key);

  if (view.kind === "app") {
    const app = connectors.rows.find((c) => c.key === view.key);
    const people = signIns(view.key);
    if (!app) return <GoBack to={home} />;
    const disconnect = async (): Promise<void> => {
      for (const c of people) { const out = await action.run("connections.delete", { connectionId: c.connectionId }, "Disconnected"); if (out === undefined) return; }
      home();
    };
    return (
      <View testID="console-app-detail">
        <Section title={app.title} right={<Button label="All apps" testID="app-back" onPress={home} />}>
          <Group>
            <Row title={app.title} note={whatItDoes(app)} leading={<Logo name={app.title} />} trailing={<StatusLabel status={people.length ? "active" : "disabled"} />} />
          </Group>
        </Section>
        <Section title="People signed in" count={people.length} right={<Button label="Add a sign-in" testID="app-add-signin" onPress={() => setView({ kind: "connect", key: app.key })} />}>
          <Group>
            {people.map((c) => <Row key={c.connectionId} id={`app-signin-${c.connectionId}`} title={c.owner.kind === "space" ? data.space.name : data.name(c.owner.id)} note={`${c.title} · ${c.state.replaceAll("_", " ")}`} onPress={() => setView({ kind: "connection", id: c.connectionId, from: app.key })} />)}
            {!people.length ? <Row title="Nobody has signed in yet" /> : null}
          </Group>
        </Section>
        <Section title="Stop using this app">
          <Group>
            <Row title="Stop using this app in the Space" note="Everyone's sign-ins to it end" trailing={<Button label="Disconnect" testID="app-disconnect" danger disabled={!people.length || action.busy} why={!people.length ? "Nobody is signed in" : undefined} onPress={() => setConfirm(app.key)} />} />
          </Group>
          {confirm === app.key ? (
            <>
              <Note>Disconnect {app.title}? {people.length === 1 ? "One sign-in ends." : `${people.length} sign-ins end.`} Automations and syncs that use it stop until someone connects it again.</Note>
              <Actions>
                <Button label="Cancel" testID="app-disconnect-cancel" onPress={() => setConfirm("")} />
                <Button label="Disconnect" testID="app-disconnect-confirm" danger disabled={action.busy} onPress={() => void disconnect()} />
              </Actions>
            </>
          ) : null}
        </Section>
        {!app.builtin ? <Section title="Settings"><Group><Row title="Connection settings" note="Who may use it, versions and tests" trailing={<Button label="Open settings" testID="app-settings" onPress={() => setView({ kind: "settings", key: app.key })} />} /></Group></Section> : null}
        {action.note ? <Note>{action.note}</Note> : null}
      </View>
    );
  }

  const loose = otherSignIns(connections.rows, connectors.rows);
  const googleOn = google.data?.configured === true, microsoftOn = microsoft.data?.consentGiven === true;
  const count = apps.length + 3;
  return (
    <View testID="console-apps">
      <Section title="Connected apps" count={count} right={<Button label="Add a custom app" testID="apps-new" onPress={() => setView({ kind: "newapp" })} />}>
        <Group testID="apps-list">
          {apps.map((c) => (
            <Row key={c.key} id={`app-${c.key}`} title={c.title} note={whatItDoes(c)} leading={<Logo name={c.title} />}
              trailing={c.connections > 0
                ? <Actions><StatusLabel status="active" /><Button label="Manage" testID={`app-manage-${c.key}`} onPress={() => setView({ kind: "app", key: c.key })} />{!c.builtin ? <Button label="Settings" testID={`app-settings-${c.key}`} onPress={() => setView({ kind: "settings", key: c.key })} /> : null}</Actions>
                : <Actions>{c.state === "live" ? <Button label="Connect" testID={`app-connect-${c.key}`} onPress={() => setView({ kind: "connect", key: c.key })} /> : null}{!c.builtin ? <Button label="Settings" testID={`app-settings-${c.key}`} onPress={() => setView({ kind: "settings", key: c.key })} /> : null}</Actions>} />
          ))}
          <Row id="app-google" title="Google Workspace" note={googleOn ? `Connected${google.data?.domain ? ` for ${google.data.domain}` : ""}` : "Sign-in, mail, calendar and files for the whole company"} leading={<Logo name="Google Workspace" />}
            trailing={googleOn
              ? <Actions><StatusLabel status="active" /><Button label="Manage" testID="app-manage-google" onPress={() => data.nav.openPage("google")} /></Actions>
              : <Button label="Connect" testID="app-connect-google" onPress={() => data.nav.openPage("google")} />} />
          <Row id="app-microsoft" title="Microsoft 365" note={microsoftOn ? "Connected" : "Sign-in, mail, calendar and files for the whole company"} leading={<Logo name="Microsoft 365" />}
            trailing={microsoftOn
              ? <Actions><StatusLabel status="active" /><Button label="Manage" testID="app-manage-microsoft" onPress={() => data.nav.openPage("microsoft")} /></Actions>
              : <Button label="Connect with admin consent" testID="app-connect-microsoft" onPress={() => data.nav.openPage("microsoft")} />} />
          <Row id="app-kit" title="Kit" note="The scripts and tools your Space runs" leading={<Logo name="Kit" />}
            trailing={<Button label="Open diagnostics" testID="app-kit-diagnostics" onPress={() => data.nav.openPage("diagnostics")} />} />
        </Group>
      </Section>
      {loose.length ? (
        <Section title="Other sign-ins" count={loose.length}>
          <Group testID="apps-other">
            {loose.map((c) => <Row key={c.connectionId} id={`app-other-${c.connectionId}`} title={c.title} note={`Signed in by ${c.owner.kind === "space" ? data.space.name : data.name(c.owner.id)}`} leading={<Logo name={c.title} />} onPress={() => setView({ kind: "connection", id: c.connectionId, from: "" })} />)}
          </Group>
        </Section>
      ) : null}
      {action.note ? <Note>{action.note}</Note> : null}
    </View>
  );
}
