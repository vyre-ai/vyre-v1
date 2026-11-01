// Settings > Computers > Phone access: claim a name like alex.vyre.run once, and a phone opens this computer there while it is on and online. A status dot, copy link, a QR for the phone's camera, and Release.
// The relay only passes sealed bytes; the link's fragment carries this computer's public key, which the phone pins (relay/worker/phone.js).
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../ui/src/Dialog/index.tsx";
import { TextField } from "../../../../../ui/src/TextField/index.tsx";
import { QrCode } from "../../onboarding/QrCode.tsx";
import { useSettingsData } from "./data.tsx";
import { phoneDotHelp, phoneNameOf, phonePollMs, phoneSub, validPhoneName } from "./phone-model.ts";
import type { PhoneInfo } from "./phone-model.ts";
import { Glyph, Section, SettingsRow, SmallButton, Tip } from "./ui.tsx";

function Dot({ on, why }: { on: boolean; why?: string }): ReactElement {
  return <Tip help={why}><View accessibilityLabel={on ? "Online" : "Offline"} testID={on ? "phone-dot-on" : "phone-dot-off"} style={[st.dot, { backgroundColor: (on ? "var(--ok, #2f9e5b)" : "var(--ink-4)") as string }]} /></Tip>;
}

const WHAT = "Open this computer from your phone at a short address, while it is on and online. Everything is sealed between your phone and this computer.";
const copyText = (text: string): void => { void (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard?.writeText(text); };

export interface PhoneBodyProps {
  phone: PhoneInfo;
  confirming: boolean;
  busy: boolean;
  onClaim(): void;
  onCopy(): void;
  onQr(): void;
  onAskRelease(yes: boolean): void;
  onRelease(): void;
}

/** The rows: one to claim, or the claimed address with its status dot and its actions. */
export function PhoneBody({ phone, confirming, busy, onClaim, onCopy, onQr, onAskRelease, onRelease }: PhoneBodyProps): ReactElement {
  const held = phone.state === "claimed" || phone.state === "releasing";
  const sub = phoneSub(phone);
  return (
    <Section title="Phone access" testID="phone-access">
      {held && phone.name ? (
        <SettingsRow
          id="phone.address" first label={`${phone.name}.vyre.run`} lead={<Dot on={phone.online} {...(phoneDotHelp(phone) ? { why: phoneDotHelp(phone)! } : {})} />} sub={sub} help={WHAT}
          control={phone.state === "releasing" ? undefined : confirming ? (
            <>
              <SmallButton label="Cancel" onPress={() => onAskRelease(false)} />
              <SmallButton label="Release" danger testID="phone-release-yes" disabled={busy} onPress={onRelease} />
            </>
          ) : (
            <>
              <SmallButton label="Copy link" testID="phone-copy" onPress={onCopy} />
              <SmallButton label="QR" testID="phone-qr" onPress={onQr} />
              <SmallButton label="Release" testID="phone-release" onPress={() => onAskRelease(true)} />
            </>
          )}
        />
      ) : (
        <SettingsRow
          id="phone.claim" first label="Phone access" lead={<Glyph name="globe" />} help={WHAT}
          {...(sub ? { sub, subAlert: phone.state === "failed" } : {})}
          control={phone.state === "claiming" ? undefined : <SmallButton label={phone.state === "failed" ? "Try again" : "Claim a name"} testID="phone-claim" onPress={onClaim} />}
        />
      )}
    </Section>
  );
}

export interface ClaimSheetProps { name: string; busy: boolean; error: string; onName(v: string): void; onClaim(): void; onClose(): void }

export function ClaimSheet({ name, busy, error, onName, onClaim, onClose }: ClaimSheetProps): ReactElement {
  return (
    <Dialog
      title="Phone access" testID="phone-claim-sheet" width={460} onClose={onClose}
      actions={[{ label: "Cancel", testID: "phone-cancel", onPress: onClose }, { label: busy ? "Claiming" : "Claim", testID: "phone-make", primary: true, disabled: busy || !validPhoneName(name), onPress: onClaim }]}
    >
      {error ? <Text accessibilityRole="alert" testID="phone-error" style={st.error}>{error}</Text> : null}
      <View style={st.row}>
        <TextField testID="phone-name" accessibilityLabel="Name" placeholder="alex" value={name} onChangeText={onName} />
        <Text style={st.suffix}>.vyre.run</Text>
      </View>
    </Dialog>
  );
}

export function QrSheet({ link, onClose }: { link: string; onClose(): void }): ReactElement {
  return (
    <Dialog title="Open on your phone" testID="phone-qr-sheet" width={360} onClose={onClose} actions={[{ label: "Done", testID: "phone-qr-done", primary: true, onPress: onClose }]}>
      <View style={st.center}><QrCode text={link} size={220} /></View>
    </Dialog>
  );
}

/** The Phone access section with its live data. Hidden when this host does not offer it. */
export function PhoneAccessSection(): ReactElement | null {
  const data = useSettingsData();
  const [phone, setPhone] = useState<PhoneInfo | null>(null);
  const [sheet, setSheet] = useState<{ name: string } | null>(null);
  const [qr, setQr] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async (): Promise<void> => {
    try { const p = await data.call("network.phone", {}) as PhoneInfo; if (alive.current) setPhone(p); } catch { /* this host has no phone access: the section stays hidden */ }
  }, [data]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!phone) return undefined;
    const t = setInterval(() => void load(), phonePollMs(phone));
    return () => clearInterval(t);
  }, [phone, load]);

  if (!phone) return null;
  const claim = async (): Promise<void> => {
    if (!sheet) return;
    setBusy(true); setError("");
    try {
      await data.call("network.phone_claim", { idempotencyKey: `phone-${Math.random().toString(36).slice(2)}`, name: phoneNameOf(sheet.name), nickname: data.space.name });
      setSheet(null);
      await load();
    } catch { if (alive.current) setError("Could not start. Try again."); } finally { if (alive.current) setBusy(false); }
  };
  const release = async (): Promise<void> => {
    setBusy(true);
    try { await data.call("network.phone_release", { idempotencyKey: `phone-${Math.random().toString(36).slice(2)}` }); setConfirming(false); await load(); } catch { /* the row stays; try again */ } finally { if (alive.current) setBusy(false); }
  };
  return (
    <>
      <PhoneBody
        phone={phone} confirming={confirming} busy={busy}
        onClaim={() => { setError(""); setSheet({ name: phone.name ?? "" }); }} onCopy={() => { if (phone.link) copyText(phone.link); }} onQr={() => setQr(true)}
        onAskRelease={setConfirming} onRelease={() => void release()}
      />
      {sheet ? <ClaimSheet name={sheet.name} busy={busy} error={error} onName={(v) => setSheet({ name: v })} onClaim={() => void claim()} onClose={() => setSheet(null)} /> : null}
      {qr && phone.link ? <QrSheet link={phone.link} onClose={() => setQr(false)} /> : null}
    </>
  );
}

const st = StyleSheet.create({
  dot: { width: 9, height: 9, borderRadius: 5 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  suffix: { fontSize: 14, color: "var(--ink-3)" as string },
  error: { color: "var(--danger)" as string, fontSize: 13, marginBottom: 8 },
  center: { alignItems: "center", paddingVertical: 8 },
});
