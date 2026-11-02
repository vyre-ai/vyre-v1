// Vault > AI providers: the way forward, right in the section, so it is never an empty list. In a Team Space, first whether the Space AI key already covers the person; then Connect
// Claude, Connect ChatGPT and Connect Grok (the ones not connected yet) and an API key. Each row only opens the Vault's own Add an AI provider sheet on that choice: the sign-in
// itself is that sheet's, unchanged.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { SpaceAiStatus } from "../../../ai-signin/SpaceAiStatus.tsx";
import { SIGNIN_BUTTONS } from "../../../ai-signin/flow.ts";
import { useVaultData } from "../layout/data.tsx";
import { LogoTile } from "../layout/parts.tsx";
import type { ConnectionKind } from "./model.ts";

export interface ConnectHereProps {
  /** Provider keys already connected by a sign-in: their Connect row is left out. */
  connected: ReadonlySet<string>;
  /** Open Add an AI provider, on this provider and way of connecting, or on its gallery. */
  onPick(initial: { providerKey: string; connection: ConnectionKind } | null): void;
}

export function ConnectHere({ connected, onPick }: ConnectHereProps): ReactElement {
  const data = useVaultData();
  const rows: ReactElement[] = [];
  for (const o of SIGNIN_BUTTONS) {
    if (connected.has(o.key)) continue;
    rows.push(<Row key={o.key} id={`vault-connect-${o.key}`} title={`Connect ${o.label}`} note="Sign in with your plan" leading={<View style={s.logo}><LogoTile name={o.label} size={26} /></View>} onPress={() => onPick({ providerKey: o.key, connection: "subscription" })} />);
  }
  rows.push(<Row key="api-key" id="vault-connect-key" title="Use an API key" note="OpenCode Go, Anthropic, OpenAI, OpenRouter and more" onPress={() => onPick(null)} />);
  return (
    <View style={s.wrap} testID="vault-connect-here">
      {data.personal === true ? null : <SpaceAiStatus call={(cap, input) => data.call(cap, input ?? {})} me={data.me.id} testID="vault-space-ai" />}
      <Text style={s.head}>Connect your AI</Text>
      <View style={s.box}>{rows}</View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 10, gap: 6 },
  head: { fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string, paddingHorizontal: 4 },
  box: { borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, padding: 4, backgroundColor: "var(--win)" as string },
  logo: { marginRight: 10 },
});
