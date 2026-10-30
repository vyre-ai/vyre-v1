// Team step 2, AI for the Space: the owner's own account here (with the "use the same account" offer when their Personal Space has a key), or a fresh sign-in or key. Everything
// lands in the owner's private Mine folder in this Space. A shared key for everyone is set later in the Console.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { ConnectAiCard } from "./ConnectAiCard.tsx";
import { SameAccountOffer } from "./SameAccountOffer.tsx";
import { copyableAccounts } from "./same-account.ts";
import type { CopyableAccount } from "./same-account.ts";

export function SpaceAiCard({ team, personal, onConnected }: { team: CapCall; /** the Personal Space on this device, when there is one */ personal: CapCall | null; onConnected(providerId: string): void }): ReactElement {
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
      <Text style={{ fontSize: 12.5, color: "var(--ink-3)" as string }}>A shared key for everyone in the Space can be added later in the Console.</Text>
    </View>
  );
}
