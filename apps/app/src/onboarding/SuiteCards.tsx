import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { connections, createInviteLink, directory, invites, ssoProviders, stepDoneBy } from "./suite.ts";
import type { Probe } from "./suite.ts";

const NOT_YET = "This part is not set up yet. You can come back to it from the checklist.";

function Buttons({ children }: { children: ReactElement | (ReactElement | null)[] }): ReactElement { return <View style={s.row}>{children}</View>; }
function Go({ id, label, onPress, ghost }: { id: string; label: string; onPress(): void; ghost?: boolean }): ReactElement {
  return <Pressable testID={id} accessibilityRole="button" onPress={onPress} style={ghost ? s.ghost : s.primary}><Text style={ghost ? s.ghostText : s.primaryText}>{label}</Text></Pressable>;
}
const line = (p: Probe<unknown>, ok: string): string => (p.kind === "ready" ? ok : p.kind === "not_yet" ? NOT_YET : "Could not read this right now.");

/** Step 3: Google Workspace or Microsoft 365. Setup itself lives in the Console pages; the secure fields there send keys straight to the Vault. */
export function WorkspaceCard({ call, onOpenConsole, onDone }: { call: CapCall; onOpenConsole(): void; onDone(): void }): ReactElement {
  const [c, setC] = useState<Awaited<ReturnType<typeof connections>> | null>(null);
  useEffect(() => { let off = false; void connections(call).then((r) => { if (!off) setC(r); }); return () => { off = true; }; }, [call]);
  const rows = c ? [c.google, c.microsoft] : [];
  return (
    <View testID="workspace-card" style={s.col}>
      <Text style={s.line}>Connect Google Workspace or Microsoft 365 so people and mailboxes come in. The admin steps are in the Console, with secure fields for keys and a live test.</Text>
      {c === null ? <Text style={s.dim}>Checking</Text> : rows.map((p, i) => <Text key={i} testID={`workspace-${i === 0 ? "google" : "microsoft"}`} style={s.dim}>{p.kind === "ready" ? `${p.value.name}: ${p.value.note}` : `${i === 0 ? "Google Workspace" : "Microsoft 365"}: ${line(p, "")}`}</Text>)}
      <Buttons><Go id="workspace-open" label="Open the setup in the Console" onPress={onOpenConsole} />{c && stepDoneBy(c) ? <Go id="workspace-done" label="Done" ghost onPress={onDone} /> : null}</Buttons>
    </View>
  );
}

export function SignInDomainCard({ call, onOpenConsole, onDone }: { call: CapCall; onOpenConsole(): void; onDone(): void }): ReactElement {
  const [p, setP] = useState<Awaited<ReturnType<typeof ssoProviders>> | null>(null);
  useEffect(() => { let off = false; void ssoProviders(call).then((r) => { if (!off) setP(r); }); return () => { off = true; }; }, [call]);
  return (
    <View testID="signin-domain-card" style={s.col}>
      <Text style={s.line}>Let people sign in with their work account for your domain, in the same app.</Text>
      {p === null ? <Text style={s.dim}>Checking</Text> : <Text style={s.dim}>{p.kind === "ready" ? (p.value.length ? `Turned on: ${p.value.map((x) => x.provider).join(", ")}.` : "Not turned on yet.") : line(p, "")}</Text>}
      <Buttons><Go id="signin-open" label="Open sign-in settings" onPress={onOpenConsole} /><Go id="signin-done" label="Done" ghost onPress={onDone} /></Buttons>
    </View>
  );
}

export function DirectoryCard({ call, onOpenConsole, onDone }: { call: CapCall; onOpenConsole(): void; onDone(): void }): ReactElement {
  const [d, setD] = useState<Awaited<ReturnType<typeof directory>> | null>(null);
  useEffect(() => { let off = false; void directory(call).then((r) => { if (!off) setD(r); }); return () => { off = true; }; }, [call]);
  return (
    <View testID="directory-card" style={s.col}>
      <Text style={s.line}>Import your directory, tick the people to bring in and give each a role. Accounts are made for the ones you pick.</Text>
      {d === null ? <Text style={s.dim}>Checking</Text> : <Text testID="directory-status" style={s.dim}>{d.kind === "ready" ? `${d.value.people} people found in your directory.` : line(d, "")}</Text>}
      <Buttons><Go id="directory-open" label="Open People in the Console" onPress={onOpenConsole} /><Go id="directory-done" label="Done" ghost onPress={onDone} /></Buttons>
    </View>
  );
}

/** Step 6: invites. Making a link sends nothing; the owner decides who gets it. */
export function InvitesCard({ call, onDone }: { call: CapCall; onDone(): void }): ReactElement {
  const attempt = useRef(0);
  const [list, setList] = useState<Awaited<ReturnType<typeof invites>> | null>(null);
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let off = false; void invites(call).then((r) => { if (!off) setList(r); }); return () => { off = true; }; }, [call]);
  const make = async (): Promise<void> => {
    setError("");
    try { setLink(await createInviteLink(call, "Member", email.trim() || undefined, `onb-invite-${Date.now()}-${attempt.current++}`)); } catch { setError("Could not make an invite. Try again."); }
  };
  return (
    <View testID="invites-card" style={s.col}>
      <Text style={s.line}>Make an invite for each person. Nothing is sent until you share it or approve it.</Text>
      {list?.kind === "ready" ? <Text testID="invites-count" style={s.dim}>{`${list.value.filter((i) => i.state === "open").length} open invites.`}</Text> : null}
      <TextInput testID="invite-email" accessibilityLabel="Email" value={email} onChangeText={setEmail} placeholder="Their email, if you know it" autoCapitalize="none" style={s.input} />
      {link ? <Text selectable testID="invite-link" style={s.link}>{link}</Text> : null}
      {error ? <Text testID="invite-error" style={s.err}>{error}</Text> : null}
      <Buttons><Go id="invite-make" label={link ? "Make another" : "Make an invite link"} onPress={() => void make()} /><Go id="invites-done" label="Done" ghost onPress={onDone} /></Buttons>
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 10 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  line: { fontSize: 14, lineHeight: 20, color: "var(--ink)" as string },
  dim: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  err: { fontSize: 13, color: "var(--danger, #c0392b)" as string },
  link: { fontSize: 13, color: "var(--ink)" as string, padding: 10, borderRadius: 8, backgroundColor: "var(--win)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  input: { height: 40, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, color: "var(--ink)" as string, fontSize: 14 },
  primary: { height: 34, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  primaryText: { fontSize: 13.5, fontWeight: "500", color: "#fff" },
  ghost: { height: 34, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  ghostText: { fontSize: 13.5, color: "var(--ink)" as string },
});
