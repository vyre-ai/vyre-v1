// Verify for the profile email and phone (lane l-chrome2a): under the field, "Verified" with a tick only after the code was confirmed, else "Not verified" and a Verify button when this Space can send a code.
// Verify sends a 6-digit code; the person types it here. Changing the value in the field clears the tick (the module does it), so this asks again whenever the value changes.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useSettingsData } from "./data.tsx";
import { Glyph, SmallButton } from "./ui.tsx";

type Channel = "email" | "phone";
interface State { verified: boolean; canVerify: boolean; pending: boolean }

/** A refusal in the words the module wrote, else a plain default. */
const sayOf = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message : fallback);

export function ContactVerify({ channel, value }: { channel: Channel; value: string }): ReactElement | null {
  const data = useSettingsData();
  const [state, setState] = useState<State | null>(null);
  const [asking, setAsking] = useState(false);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = useCallback(async (): Promise<void> => {
    try {
      const r = (await data.call("settings.contact.status", {})) as Record<Channel, State>;
      if (mounted.current) setState(r[channel] ?? null);
    } catch { if (mounted.current) setState(null); }
  }, [data, channel]);
  // the value changed (or the page opened): read again, and drop a code box for the value that went
  useEffect(() => { setAsking(false); setCode(""); setNote(""); void load(); }, [value, load]);
  if (value === "") return null;
  if (state?.verified) return <View style={st.row} testID={`verified-${channel}`}><Glyph name="check" size={13} color="var(--ok)" /><Text style={st.ok}>Verified</Text></View>;
  const send = async (): Promise<void> => {
    setBusy(true); setNote("");
    try { await data.call("settings.contact.verify_start", { channel }); if (mounted.current) { setAsking(true); setNote(channel === "email" ? "We sent a 6-digit code to that address." : "We texted a 6-digit code to that number."); } }
    catch (e) { if (mounted.current) setNote(sayOf(e, "The code could not be sent. Try again.")); }
    finally { if (mounted.current) setBusy(false); }
  };
  const confirm = async (): Promise<void> => {
    setBusy(true); setNote("");
    try { await data.call("settings.contact.verify_confirm", { channel, code: code.trim() }); setAsking(false); setCode(""); await load(); }
    catch (e) { if (mounted.current) setNote(sayOf(e, "That did not work. Try again.")); }
    finally { if (mounted.current) setBusy(false); }
  };
  return (
    <View style={st.col} testID={`verify-${channel}`}>
      <View style={st.row}>
        <Text style={st.muted} testID={`unverified-${channel}`}>Not verified</Text>
        {state?.canVerify && !asking ? <SmallButton label="Verify" testID={`verify-open-${channel}`} disabled={busy} onPress={() => void send()} /> : null}
      </View>
      {asking ? (
        <View style={st.row}>
          <TextInput accessibilityLabel="Verification code" testID={`verify-code-${channel}`} value={code} onChangeText={setCode} placeholder="6-digit code" placeholderTextColor="var(--ink-4)" keyboardType="number-pad" maxLength={8} style={st.input} />
          <SmallButton label="Confirm" primary testID={`verify-confirm-${channel}`} disabled={busy || code.trim().length < 4} onPress={() => void confirm()} />
          <SmallButton label="Send again" testID={`verify-again-${channel}`} disabled={busy} onPress={() => void send()} />
        </View>
      ) : null}
      {note ? <Text style={st.note} testID={`verify-note-${channel}`}>{note}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  col: { gap: 6, alignItems: "flex-end" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  ok: { fontSize: 12, color: "var(--ok)" as string },
  muted: { fontSize: 12, color: "var(--ink-3)" as string },
  note: { fontSize: 12, color: "var(--ink-3)" as string, maxWidth: 320 },
  input: { width: 120, height: 28, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, color: "var(--ink)" as string, fontSize: 13 },
});
