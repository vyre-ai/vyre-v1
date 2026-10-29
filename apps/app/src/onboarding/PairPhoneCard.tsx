// Phone card: a pairing link that works once for ten minutes. Open it on the phone (scan it if your camera app reads links from the screen) and the phone joins this Space.
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { pairLink } from "../shell/session/desktop.ts";

export async function makePairLink(call: CapCall, address: string, idempotencyKey: string): Promise<{ link: string; expiresAt: number }> {
  const out = await call("identity.pair_create", { purpose: "app", idempotencyKey }) as { code: string; expiresAt: number };
  return { link: pairLink(address, out.code), expiresAt: out.expiresAt };
}

export function PairPhoneCard({ call, address, onPaired }: { call: CapCall; address: string; onPaired?(): void }): ReactElement {
  const attempt = useRef(0);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const make = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setError("");
    try { setLink((await makePairLink(call, address, `${Date.now()}:${attempt.current++}`)).link); } catch { setError("Could not make a pairing link. Try again."); } finally { setBusy(false); }
  };
  return (
    <View testID="pair-phone" style={s.col}>
      {link ? <Text selectable testID="pair-link" style={s.link}>{link}</Text> : null}
      {link ? <Text style={s.dim}>Open this on your phone. It works once and expires in ten minutes.</Text> : <Text style={s.dim}>Make a link and open it on your phone to pair it.</Text>}
      {error ? <Text testID="pair-error" style={s.err}>{error}</Text> : null}
      <View style={s.row}>
        <Pressable testID="pair-make" accessibilityRole="button" disabled={busy} onPress={() => void make()} style={[s.primary, busy && s.off]}><Text style={s.primaryText}>{link ? "Make a new link" : "Make a pairing link"}</Text></Pressable>
        {link && onPaired ? <Pressable testID="pair-done" accessibilityRole="button" onPress={onPaired} style={s.ghost}><Text style={s.ghostText}>My phone is paired</Text></Pressable> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 10 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  link: { fontSize: 13, color: "var(--ink)" as string, padding: 10, borderRadius: 8, backgroundColor: "var(--win)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  dim: { fontSize: 12.5, color: "var(--ink-3)" as string },
  err: { fontSize: 13, color: "var(--danger, #c0392b)" as string },
  primary: { height: 34, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  primaryText: { fontSize: 13.5, fontWeight: "500", color: "#fff" },
  ghost: { height: 34, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  ghostText: { fontSize: 13.5, color: "var(--ink)" as string },
  off: { opacity: 0.45 },
});
