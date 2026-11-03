// Settings > Sign-in > Use one account everywhere (rc.17). A person who made two Vyre accounts before one account worked across Spaces (a Personal one and a team one, say) keeps one. They
// prove both on this device: the kept account with its password, the other with its password or its recovery code. The other Space then signs them in with the kept username, password and
// recovery code; their data, role and membership there stay. Every old session there ends; this device signs in again by itself.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TextField } from "../../../../../ui/src/TextField/index.tsx";
import { Dialog } from "../../../../../ui/src/Dialog/index.tsx";
import { Glyph } from "./ui.tsx";
import { linkAccounts, linkSides } from "./security.ts";
import type { LinkSide } from "./security.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;
export interface LinkSheetProps {
  /** every Space this device is signed in to, this one first */
  spaces: readonly { name: string; spaceId: string; call: Call }[];
  device: { deviceName: string; deviceClass: string };
  /** the other Space answered with a new session for this device: store it (and reload when it is the open Space) */
  onSession(spaceId: string, token: string, username: string): void;
  onClose(): void;
  /** tests and screenshots: the sides already read, and what is shown */
  initial?: { sides: LinkSide[]; keep?: string; other?: string; done?: boolean; error?: string };
}

const pairs = (sides: readonly LinkSide[]): Array<[LinkSide, LinkSide]> => {
  const out: Array<[LinkSide, LinkSide]> = [];
  for (const a of sides) for (const b of sides) if (a.spaceId !== b.spaceId && a.publicKey !== b.publicKey) out.push([a, b]);
  return out;
};

export function LinkSheet({ spaces, device, onSession, onClose, initial }: LinkSheetProps): ReactElement {
  const [sides, setSides] = useState<LinkSide[] | null>(initial?.sides ?? null);
  const [keepId, setKeepId] = useState<string | null>(initial?.keep ?? null);
  const [otherId, setOtherId] = useState<string | null>(initial?.other ?? null);
  const [keepPw, setKeepPw] = useState("");
  const [otherSecret, setOtherSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initial?.error ?? "");
  const [done, setDone] = useState(initial?.done ?? false);
  const inFlight = useRef(false);
  useEffect(() => {
    if (sides) return undefined;
    let live = true;
    void linkSides(spaces).then((got) => { if (live) setSides(got); }, () => { if (live) setSides([]); });
    return () => { live = false; };
  }, [sides, spaces]);
  const options = pairs(sides ?? []);
  const here = sides?.[0] ?? null;
  // the choice: which account to keep. The other side is this Space, or the one other account this device has
  const accounts = sides ? sides.filter((x) => options.some(([a]) => a.spaceId === x.spaceId)) : [];
  const keep = accounts.find((x) => x.spaceId === keepId) ?? null;
  const othersFor = keep ? options.filter(([a]) => a.spaceId === keep.spaceId).map(([, b]) => b) : [];
  const other = othersFor.find((x) => x.spaceId === otherId) ?? (othersFor.length === 1 ? othersFor[0]! : null);
  const submit = async (): Promise<void> => {
    if (inFlight.current || !keep || !other) return;
    inFlight.current = true; setBusy(true); setError("");
    try { await linkAccounts(keep, keepPw, other, otherSecret, device, onSession); setKeepPw(""); setOtherSecret(""); setDone(true); }
    catch (e) {
      const code = (e as { code?: string } | null)?.code;
      setError(code === "validation.duplicate" ? `The username ${keep.username} is taken in ${other.name}. Keep the other account instead.`
        : code === "bad_secret" || code === "auth.bad_credentials" || code === "auth.invalid_code" ? "Check both passwords, or the recovery code. Nothing changed."
          : "Couldn’t finish. Nothing changed. Try again.");
    } finally { inFlight.current = false; setBusy(false); }
  };
  const para = (t: string, id?: string): ReactElement => <Text style={st.para} {...(id ? { testID: id } : {})}>{t}</Text>;
  const field = (id: string, label: string, value: string, set: (v: string) => void): ReactElement => <View style={st.row}><Text style={st.label}>{label}</Text><TextField testID={id} accessibilityLabel={label} value={value} onChangeText={set} secureTextEntry autoCapitalize="none" autoCorrect={false} /></View>;
  const pick = (x: LinkSide, on: boolean, onPress: () => void, id: string): ReactElement => (
    <Pressable key={x.spaceId} testID={id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={onPress} style={[st.choice, on ? st.on : null]}>
      <View style={{ flex: 1 }}><Text style={st.title}>{x.username}</Text><Text style={st.sub}>{`Your account in ${x.name}`}</Text></View>
      {on ? <Glyph name="check" size={14} color="var(--accent)" /> : null}
    </Pressable>
  );
  let body: ReactElement;
  if (done && keep && other) body = para(`${other.name} now signs you in as ${keep.username}, with the same password and recovery code as ${keep.name}. Your work there is unchanged. Other devices signed in to ${other.name} sign in again.`, "link-done");
  else if (done) body = para("Done. Both Spaces now use one account.", "link-done");
  else if (!sides) body = para("Reading your Spaces…");
  else if (options.length === 0) body = para(here ? "Every Space on this device already uses one Vyre account." : "Sign in to the Spaces you want to join up on this device first.", "link-none");
  else {
    body = <>
      {para("You have more than one Vyre account. Keep one: the other Space signs you in with it from now on. Your work, role and place there stay.")}
      <Text style={st.label}>Keep</Text>
      <View style={st.list}>{accounts.map((x) => pick(x, keep?.spaceId === x.spaceId, () => { setKeepId(x.spaceId); setOtherId(null); setError(""); }, `link-keep-${x.spaceId}`))}</View>
      {keep && othersFor.length > 1 ? <><Text style={st.label}>Instead of</Text><View style={st.list}>{othersFor.map((x) => pick(x, other?.spaceId === x.spaceId, () => setOtherId(x.spaceId), `link-other-${x.spaceId}`))}</View></> : null}
      {keep && other ? <>
        {field("link-keep-password", `Password for ${keep.username}`, keepPw, setKeepPw)}
        {field("link-other-secret", `Password or recovery code for ${other.username} in ${other.name}`, otherSecret, setOtherSecret)}
        {para(`${other.name} will sign you in as ${keep.username}. Old sessions there end.`, "link-what")}
      </> : null}
      {error ? <Text accessibilityRole="alert" style={st.error} testID="link-error">{error}</Text> : null}
    </>;
  }
  const ready = !!keep && !!other && !!keepPw && !!otherSecret && !busy;
  return (
    <Dialog
      title="Use one account everywhere" testID="link-sheet" onClose={onClose} width={500}
      actions={[{ label: done ? "Done" : "Cancel", testID: "link-close", onPress: onClose }, ...(!done && options.length ? [{ label: busy ? "Joining up…" : "Use one account", primary: true, disabled: !ready, testID: "link-save", onPress: () => void submit() }] : [])]}
    >
      {body}
    </Dialog>
  );
}

const st = StyleSheet.create({
  row: { gap: 6 },
  label: { color: "var(--ink-2)" as string, fontSize: 12.5, fontWeight: "500" },
  para: { color: "var(--ink-2)" as string, fontSize: 13.5, lineHeight: 20 },
  error: { color: "var(--danger)" as string, fontSize: 13 },
  list: { borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, overflow: "hidden" },
  choice: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  on: { backgroundColor: "var(--sunk)" as string },
  title: { color: "var(--ink)" as string, fontSize: 14, fontWeight: "500" },
  sub: { color: "var(--ink-3)" as string, fontSize: 12.5, marginTop: 1 },
});
