// Phone card: a pairing link that works once for ten minutes. Open it on the phone (scan it if your camera app reads links from the screen) and the phone joins this Space. It makes no link on an address only this computer can use (127.0.0.1, localhost): a phone cannot open that.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { phoneCanReach, pairLink } from "../shell/session/desktop.ts";
import { QrCode } from "./QrCode.tsx";
import { CARD } from "./card-style.ts";

/** This computer's phone address (Settings > Computers > Phone access), when it has claimed one: the https name and the box key its link carries. */
export interface PhoneAddress { url: string; boxKey: string }
export async function phoneAddressOf(call: CapCall): Promise<PhoneAddress | null> {
  try {
    const p = await call("network.phone", {}) as { state?: string; url?: string; link?: string };
    const key = /#box=([A-Za-z0-9_-]{43})$/.exec(p.link ?? "")?.[1];
    return p.state === "claimed" && typeof p.url === "string" && key ? { url: p.url, boxKey: key } : null;
  } catch { return null; }
}

export async function makePairLink(call: CapCall, address: string, idempotencyKey: string, phone?: PhoneAddress | null): Promise<{ link: string; expiresAt: number }> {
  const out = await call("identity.pair_create", { purpose: "phone", idempotencyKey }) as { code: string; expiresAt: number };
  return { link: phone ? pairLink(phone.url, out.code, phone.boxKey) : pairLink(address, out.code), expiresAt: out.expiresAt };
}

export function PairPhoneCard({ call, address, onPaired, onTeamSpace }: { call: CapCall; address: string; onPaired?(): void; onTeamSpace?(): void }): ReactElement | null {
  // a Space on this computer alone has nothing a phone can open, unless the computer has claimed a vyre.run name: then the link is that name's
  const [phone, setPhone] = useState<PhoneAddress | null | undefined>(phoneCanReach(address) ? null : undefined);
  useEffect(() => { if (phone === undefined) void phoneAddressOf(call).then(setPhone); }, [call, phone]);
  if (phone === undefined) return null;
  if (!phone && !phoneCanReach(address)) return <PhoneUnreachable onTeamSpace={onTeamSpace} />;
  return <PairPhoneLive call={call} address={address} phone={phone} onPaired={onPaired} />;
}

// This Space lives on this computer only: no relay name and no network address, so a phone has nothing to open. What is offered is what works today: a server that holds the Space.
// Not offered, on purpose: a Wi-Fi link (a phone browser gives WebCrypto, which the key bundle needs, only on https, and a bare LAN address is plain http) and a relay name (the relay
// carries the box protocol, and no name-to-HTTP gateway or name claim exists in this repo yet). Both are in team/BACKLOG.md.
function PhoneUnreachable({ onTeamSpace }: { onTeamSpace: (() => void) | undefined }): ReactElement {
  return (
    <View testID="pair-phone-local" style={s.col}>
      <Text style={s.dim}>This Space runs on this computer only, so a phone cannot reach it yet.</Text>
      {onTeamSpace ? (
        <Pressable testID="pair-team" accessibilityRole="button" onPress={onTeamSpace} style={s.choice}>
          <Text style={s.choiceTitle}>Connect a server</Text>
          <Text style={s.dim}>The Space lives on a server that is always on. Your phone opens it from anywhere.</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function PairPhoneLive({ call, address, phone, onPaired }: { call: CapCall; address: string; phone: PhoneAddress | null; onPaired: (() => void) | undefined }): ReactElement {
  const attempt = useRef(0);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const make = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setError("");
    try { setLink((await makePairLink(call, address, `${Date.now()}:${attempt.current++}`, phone)).link); } catch { setError("Could not make a pairing link. Try again."); } finally { setBusy(false); }
  };
  // the code is made when the step opens, so the QR is there to scan at once
  useEffect(() => { void make(); }, []);
  return (
    <View testID="pair-phone" style={s.col}>
      {link ? <QrCode text={link} /> : null}
      {link ? <Text selectable testID="pair-link" style={s.link}>{link}</Text> : null}
      {link ? <Text style={s.dim}>Scan it, or open the link on your phone. It works once, for ten minutes.</Text> : <Text style={s.dim}>Making a link</Text>}
      {error ? <Text testID="pair-error" style={s.err}>{error}</Text> : null}
      <View style={s.row}>
        <Pressable testID="pair-make" accessibilityRole="button" disabled={busy} onPress={() => void make()} style={[s.primary, busy && s.off]}><Text style={[s.primaryText, busy && s.offText]}>{link ? "New link" : "Make a pairing link"}</Text></Pressable>
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
  err: CARD.err,
  primary: CARD.primary,
  primaryText: CARD.primaryText,
  ghost: CARD.ghost,
  ghostText: CARD.ghostText,
  choice: { gap: 4, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--win)" as string },
  choiceTitle: { fontSize: 14, fontWeight: "500", color: "var(--ink)" as string },
  off: CARD.off,
  offText: CARD.offText,
});
