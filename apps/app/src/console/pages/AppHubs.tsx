// App hubs in Console > Plugins: the shared card (apps/app/src/hubs) in a section, and the Sign in button for a remote connection that uses OAuth. The same card also sits in Settings > Connections.
import type { ReactElement } from "react";
import { Linking } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { AppHubsCard, useComeBack } from "../../hubs/AppHubs.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Button, useAction, useRead } from "./shared.tsx";

type Connection = CapMap["plugins.connections.list"]["out"]["connections"][number];

export function AppHubsSection(): ReactElement {
  const { call } = useConsoleData();
  return <Section title="App hubs"><Group><AppHubsCard call={call} /></Group></Section>;
}

/** The sign-in button of a remote connection that uses OAuth; it reads "Sign in again" once a token is held. */
export function OauthSignIn({ conn, refresh }: { conn: Connection; refresh: () => void }): ReactElement {
  const status = useRead<{ signedIn: boolean }>("engine.mcp.oauth_status", { connectionId: conn.connectionId });
  const action = useAction(() => { status.refresh(); refresh(); });
  useComeBack(status.refresh);
  const signIn = (): void => {
    const origin = (globalThis as { location?: { origin?: string } }).location?.origin ?? "";
    void action.run("engine.mcp.oauth_start", { connectionId: conn.connectionId, redirectUri: `${origin}/oauth/callback` }, (out: { authUrl: string }) => { void Linking.openURL(out.authUrl); return "Finish signing in in your browser"; });
  };
  return <Button label={status.data?.signedIn ? "Sign in again" : "Sign in"} testID={`oauth-${conn.name}`} disabled={action.busy} onPress={signIn} why={action.note || undefined} />;
}
