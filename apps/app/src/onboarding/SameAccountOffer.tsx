// The offer: "Use the same AI account here". Shown on the Team Space's AI step when the person has a copyable key in a Personal Space on this device. A yes copies that one key into
// their private Mine folder; a no leaves everything as it is.
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { copyAccount } from "./same-account.ts";
import type { CopyableAccount } from "./same-account.ts";
import { CARD } from "./card-style.ts";

export function SameAccountOffer({ personal, team, accounts, onCopied, onDeclined }: { personal: CapCall; team: CapCall; accounts: readonly CopyableAccount[]; onCopied(providerId: string): void; onDeclined?(): void }): ReactElement | null {
  const attempt = useRef(globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
  const [declined, setDeclined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const first = accounts[0];
  if (!first || declined) return null;
  const yes = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setError("");
    try { onCopied(await copyAccount(personal, team, first, `${attempt.current}:${first.providerId}`)); } catch (e) { setError(e instanceof Error ? e.message : "Could not copy this account."); } finally { setBusy(false); }
  };
  return (
    <View testID="same-account" style={s.col}>
      <Text style={s.line}>{`Use the same AI account here? Your ${first.name} key is copied into your private folder.`}</Text>
      {error ? <Text testID="same-account-error" style={s.err}>{error}</Text> : null}
      <View style={s.row}>
        <Pressable testID="same-account-yes" accessibilityRole="button" disabled={busy} onPress={() => void yes()} style={[s.primary, busy && s.off]}><Text style={[s.primaryText, busy && s.offText]}>{busy ? "Copying" : "Use the same account"}</Text></Pressable>
        <Pressable testID="same-account-no" accessibilityRole="button" onPress={() => { setDeclined(true); onDeclined?.(); }} style={s.ghost}><Text style={s.ghostText}>No, add a different one</Text></Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 10 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  line: { fontSize: 14, lineHeight: 20, color: "var(--ink)" as string },
  err: CARD.err,
  primary: CARD.primary,
  primaryText: CARD.primaryText,
  ghost: CARD.ghost,
  ghostText: CARD.ghostText,
  off: CARD.off,
  offText: CARD.offText,
});
