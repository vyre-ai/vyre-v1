// Team step 2, AI for the Space: the owner's own account here (with the "use the same account" offer when their Personal Space has a key), or a fresh sign-in or key. Everything
// lands in the owner's private Mine folder in this Space. A key for everyone (the Space AI key) is set later in Console, Models and providers.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { ConnectAiCard } from "./ConnectAiCard.tsx";
import { SameAccountOffer } from "./SameAccountOffer.tsx";
import { copyableAccounts } from "./same-account.ts";
import type { CopyableAccount } from "./same-account.ts";

/** Where the Space AI key is set, in the Console's own words (apps/app/src/console/shell/nav.ts "Models and providers"; the section is "Space AI key"). */
export const SPACE_KEY_LATER = "One key for everyone, like OpenCode Go, goes in Console, Models and providers, Space AI key.";
/** The Console page that holds it, for onGo("console", hash). */
export const SPACE_KEY_HASH = "screen=console.ai-models";

export function SpaceAiCard({ team, personal, onConnected, onOpenConsole }: { team: CapCall; /** the Personal Space on this device, when there is one */ personal: CapCall | null; onConnected(providerId: string): void; /** opens Console, Models and providers */ onOpenConsole?: () => void }): ReactElement {
  const [accounts, setAccounts] = useState<CopyableAccount[]>([]);
  const [done, setDone] = useState(false);
  const [different, setDifferent] = useState(false);
  useEffect(() => {
    if (!personal) return undefined;
    let off = false;
    void copyableAccounts(personal).then((a) => { if (!off) setAccounts(a); }).catch(() => undefined);
    return () => { off = true; };
  }, [personal]);
  // the offer comes first and alone; the sign-in tiles and the key field appear after "No, add a different one"
  const offered = !!personal && accounts.length > 0 && !done && !different;
  return (
    <View testID="space-ai" style={{ gap: 14 }}>
      {offered ? <SameAccountOffer personal={personal!} team={team} accounts={accounts} onCopied={(id) => { setDone(true); onConnected(id); }} onDeclined={() => setDifferent(true)} /> : null}
      {offered ? null : <ConnectAiCard call={team} connected={done} onConnected={onConnected} />}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Text style={{ fontSize: 12.5, color: "var(--ink-3)" as string }}>{SPACE_KEY_LATER}</Text>
        {onOpenConsole ? <Pressable accessibilityRole="link" onPress={onOpenConsole} testID="space-ai-console"><Text style={{ fontSize: 12.5, color: "var(--accent)" as string }}>Open it</Text></Pressable> : null}
      </View>
    </View>
  );
}
