// Team step 2, AI for the Space. Two clearly labelled choices: a key for everyone (the Space AI key, drawn by the Console's own SpaceKey component, so the providers, OpenCode Go
// first, the check with the provider and the wrong-prefix warning are one thing in both places), or your own account (sign in with a Claude, ChatGPT or Grok subscription, or a
// personal key, with the "use the same account" offer when the Personal Space has one). Nothing sends the person to the Console mid-setup. Continue is live once either is set.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Segmented } from "../../../../ui/src/Segmented/index.tsx";
import type { CapCall } from "../shell/session/caps.ts";
import { ConsoleDataProvider } from "../console/shell/data.tsx";
import type { ConsoleData } from "../console/shell/data.tsx";
import { SpaceKey } from "../console/pages/SpaceKey.tsx";
import { ConnectAiCard } from "./ConnectAiCard.tsx";
import { SameAccountOffer } from "./SameAccountOffer.tsx";
import { copyableAccounts } from "./same-account.ts";
import type { CopyableAccount } from "./same-account.ts";

export type SpaceAiChoice = "space" | "mine";

/** What the Console component needs to draw the Space AI key inside setup: this Space's caller, and names that never show an id. */
export function setupConsoleData(call: CapCall, me: { id: string; name: string }): ConsoleData {
  return {
    call: call as ConsoleData["call"],
    screens: {} as ConsoleData["screens"],
    me: { ...me, role: "Owner" },
    space: { id: "", name: "", address: "" },
    can: () => true,
    name: (id) => (id === me.id ? "You" : "An admin"),
    nav: { openPage: () => undefined, openApp: () => undefined },
    clock: () => ({ now: Date.now() }),
  };
}

export function SpaceAiCard({ team, personal, onConnected, gate, me = { id: "", name: "" }, initial = "space" }: {
  team: CapCall; /** the Personal Space on this device, when there is one */ personal: CapCall | null; onConnected(providerId: string): void;
  gate?(save: (() => Promise<boolean>) | null): void; me?: { id: string; name: string }; initial?: SpaceAiChoice;
}): ReactElement {
  const [choice, setChoice] = useState<SpaceAiChoice>(initial);
  const [accounts, setAccounts] = useState<CopyableAccount[]>([]);
  const [mine, setMine] = useState(false);
  const [different, setDifferent] = useState(false);
  const [spaceKey, setSpaceKey] = useState(false);
  useEffect(() => {
    if (!personal) return undefined;
    let off = false;
    void copyableAccounts(personal).then((a) => { if (!off) setAccounts(a); }).catch(() => undefined);
    return () => { off = true; };
  }, [personal]);
  useEffect(() => {
    if (!gate) return undefined;
    gate(spaceKey || mine ? async () => true : null);
    return () => gate(null);
  }, [gate, spaceKey, mine]);
  const data = useMemo(() => setupConsoleData(team, me), [team, me.id, me.name]);
  const onState = useCallback((set: boolean) => setSpaceKey(set), []);
  const connected = (id: string): void => { setMine(true); onConnected(id); };
  // the offer comes first and alone; the sign-in choices appear after "No, add a different one"
  const offered = !!personal && accounts.length > 0 && !mine && !different;
  return (
    <View testID="space-ai" style={s.col}>
      <Segmented<SpaceAiChoice>
        label="Which AI" testID="space-ai-choice" value={choice} onChange={setChoice}
        options={[{ id: "space", label: "A key for everyone", hint: "One key the whole Space runs on" }, { id: "mine", label: "Your own account", hint: "Only you use it" }]}
      />
      {choice === "space" ? (
        <View testID="space-ai-key" style={s.col}>
          <Text style={s.lead}>One key for the whole Space, like OpenCode Go. People and agents with no AI account of their own use it, and nobody can read it back.</Text>
          <ConsoleDataProvider value={data}><SpaceKey onState={onState} /></ConsoleDataProvider>
        </View>
      ) : (
        <View testID="space-ai-mine" style={s.col}>
          <Text style={s.lead}>Sign in with your Claude, ChatGPT or Grok subscription, or add a personal key. Only you use it.</Text>
          {offered ? <SameAccountOffer personal={personal!} team={team} accounts={accounts} onCopied={connected} onDeclined={() => setDifferent(true)} /> : null}
          {offered ? null : <ConnectAiCard call={team} connected={mine} onConnected={connected} />}
        </View>
      )}
      {spaceKey && choice === "mine" ? <Text testID="space-ai-key-set" style={s.lead}>The Space already has a key for everyone.</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 12 },
  lead: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
});
