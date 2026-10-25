// The page of a subscription provider (spec 3.8): the prototype's own layout, not the .env card. A big name with its handle and kind, who can use it, a grouped box with the account signed in
// and the models, Used by (each agent and Automation with its turns this month, and the month's total), then Recent use from the item's history. A sign-in has no fields to show, so there is
// no .env box. Turns come from the item's history; per-agent token counts are not in the contract, so the total is the provider's own.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AskButton } from "../../../../../../ui/src/AskButton/index.tsx";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useScreenQuery, usePrincipals, useVaultData } from "../layout/data.tsx";
import { agoLabel } from "../layout/model.ts";
import type { Provider } from "../layout/model.ts";
import { Btn, LogoTile, Mono } from "../layout/parts.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { countWords, tokenWords, userKind } from "./model.ts";

type HistoryOut = CapMap["vault.item.history"]["out"];

export interface ProviderPageProps {
  provider: Provider; handle: string; onNote(text: string): void;
  /** Tokens an agent or Automation used this month. Wired to the per-actor usage of P-CC_36 when it lands; until then it is not given and no number is drawn. */
  tokensOf?: (actorId: string) => number | undefined;
}

export function ProviderPage({ provider, handle, onNote, tokensOf }: ProviderPageProps): ReactElement {
  const data = useVaultData();
  const people = usePrincipals();
  const hist = useScreenQuery<HistoryOut>("vault.item", "history", { itemId: provider.itemId });
  const [models, setModels] = useState<readonly string[]>([]);
  useEffect(() => {
    let live = true;
    void (data.call("providers.test", { providerId: provider.id }) as Promise<{ models: string[] }>).then((o) => { if (live) setModels(o.models); }).catch(() => undefined);
    return () => { live = false; };
  }, [data, provider.id]);
  const entries = hist.status === "ready" ? hist.data.entries : [];
  const turns = (id: string): number => entries.filter((e) => e.action === "used" && (e.actor.id === id || e.onBehalfOf?.id === id)).length;
  const total = provider.agentsUsing.reduce((n, id) => n + turns(id), 0);
  const signIn = async (): Promise<void> => {
    try { const o = (await data.call("providers.subscription_start", { providerKey: provider.providerKey, idempotencyKey: `again-${provider.id}-${data.clock().now}` })) as { instruction: string }; onNote(o.instruction); } catch (e) { onNote(e instanceof Error ? e.message : "That did not work."); }
  };
  return (
    <View style={s.page} testID="provider-page" accessibilityLabel={`${provider.name}, AI provider`}>
      <View style={s.bar}><View style={{ flex: 1 }} /><AskButton place="vault" context={{ kind: "vault_item", id: provider.itemId, title: provider.name, access: "manage" }} agents={[{ id: "assistant", name: "Assistant", assistant: true }, ...people.all.filter((x) => x.kind === "agent").map((x) => ({ id: x.id, name: x.name }))]} testID="provider-ask" onAsk={(agent, mode, about) => data.nav.ask?.(agent.id, mode, { kind: about.kind, id: about.id, title: about.title })} /></View>
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.hero}>
          <LogoTile name={provider.name} size={64} />
          <View style={{ flex: 1, gap: 6 }}>
            <Text accessibilityRole="header" style={s.title}>{provider.name}</Text>
            <View style={s.meta}><View style={s.chip}><Mono size={12}>{handle}</Mono></View><Text style={s.dim}>Sign-in</Text></View>
          </View>
        </View>
        <Text style={s.dim} testID="provider-private">Only you can use it  ·  It goes wherever you work</Text>

        <View style={s.box} testID="provider-signin">
          <View style={s.boxRow}>
            <View style={{ flex: 1 }}><Text style={s.strong} testID="provider-how">{provider.via.replace(/^Sign in with /, "Signed in with ")}</Text><Text style={s.dim}>{people.name(data.me.id)}</Text></View>
            <Btn label="Sign in again" onPress={() => void signIn()} testID="provider-signin-again" />
          </View>
          <View style={s.sep} />
          <Text style={s.strong}>Models</Text>
          <Text style={s.dim} testID="provider-models">{models.length ? models.join(", ") : "Loading"}</Text>
        </View>

        <View style={s.head}><Text accessibilityRole="header" style={s.h2}>Used by</Text></View>
        {provider.agentsUsing.map((id) => (
          <Row key={id} id={`use:${id}`} title={people.name(id)} note={userKind(id) === "automation" ? "Automation you set up" : "Runs its turns on this"} leading={<View style={s.face}><Avatar name={people.name(id)} kind={userKind(id)} size={28} /></View>}
            trailing={<Text style={s.dim} testID={`use-count-${id}`}>{tokensOf?.(id) === undefined ? countWords(turns(id), "turn") : `${countWords(turns(id), "turn")}, ${tokenWords(tokensOf(id)!)}`}</Text>} />
        ))}
        <Text style={s.dim} testID="provider-total">{`This month: ${countWords(total, "turn")} across ${countWords(provider.agentsUsing.length, "agent or Automation", "agents and Automations")}, ${tokenWords(provider.usage.tokens)}.`}</Text>

        <View style={s.head}><Text accessibilityRole="header" style={s.h2}>Recent use</Text></View>
        {entries.length === 0 ? <Text style={s.dim} testID="history-empty">Nothing has used this sign-in yet.</Text> : entries.slice(0, 5).map((e, i) => (
          <Row key={i} id={`rec:${i}`} title={`${people.name(e.actor.id)} ${e.action === "used" ? "used this sign-in" : e.action}`} leading={<View style={s.face}><Avatar name={people.name(e.actor.id)} kind={userKind(e.actor.id)} size={24} /></View>}
            trailing={<Text style={s.dim}>{agoLabel(e.at, data.clock())}</Text>} />
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, minHeight: 0 },
  bar: { flexDirection: "row", alignItems: "center", height: 48, paddingHorizontal: 16 },
  body: { paddingHorizontal: 24, paddingBottom: 32, gap: 10 },
  hero: { flexDirection: "row", alignItems: "center", gap: 16, paddingTop: 8 },
  title: { fontSize: 26, fontWeight: "600", letterSpacing: -0.4, color: "var(--ink)" as string },
  meta: { flexDirection: "row", alignItems: "center", gap: 10 },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: "var(--sel)" as string },
  dim: { fontSize: 13, color: "var(--ink-3)" as string },
  strong: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  box: { marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string, padding: 14, gap: 8 },
  boxRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sep: { height: 1, backgroundColor: "var(--line)" as string },
  head: { flexDirection: "row", alignItems: "center", paddingTop: 18, paddingBottom: 2 },
  h2: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  face: { marginRight: 10 },
});
