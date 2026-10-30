import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { connections, createInviteLink, directory, importable, importPeople, invites, memberRoleId, ssoProviders, stepDoneBy } from "./suite.ts";
import type { ImportResult, Probe } from "./suite.ts";

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
  const attempt = useRef(0);
  const [d, setD] = useState<Awaited<ReturnType<typeof directory>> | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { let off = false; void directory(call).then((r) => { if (!off) setD(r); }); return () => { off = true; }; }, [call]);
  const people = d?.kind === "ready" ? importable(d.value) : [];
  const toggle = (email: string): void => setTicked((t) => { const n = new Set(t); if (n.has(email)) n.delete(email); else n.add(email); return n; });
  const run = async (): Promise<void> => {
    if (busy || d?.kind !== "ready") return;
    setBusy(true); setError("");
    try { setResult(await importPeople(call, people.filter((p) => ticked.has(p.email)), await memberRoleId(call), `onb-import-${Date.now()}-${attempt.current++}`)); } catch { setError("Could not bring these people in. Try again."); } finally { setBusy(false); }
  };
  return (
    <View testID="directory-card" style={s.col}>
      <Text style={s.line}>Tick the people to bring in. Each gets an invite as a Member. Nothing is sent: you share or approve the invites yourself.</Text>
      {d === null ? <Text style={s.dim}>Checking</Text> : d.kind !== "ready" ? <Text testID="directory-status" style={s.dim}>{line(d, "")}</Text> : people.length === 0 ? <Text testID="directory-status" style={s.dim}>Everyone in your directory is already here.</Text> : (
        <View style={s.col}>{people.map((p) => (
          <Pressable key={p.email} testID={`dir-${p.email}`} accessibilityRole="checkbox" accessibilityState={{ checked: ticked.has(p.email) }} onPress={() => toggle(p.email)} style={[s.person, ticked.has(p.email) && s.personOn]}>
            <Text style={s.line}>{p.name ?? p.email}</Text><Text style={s.dim}>{p.name ? p.email : p.source === "google" ? "Google" : "Microsoft"}</Text>
          </Pressable>
        ))}</View>
      )}
      {result ? <View testID="directory-result" style={s.col}>
        <Text style={s.dim}>{`${result.invited.length} invited${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}. Share each link with its person.`}</Text>
        {result.invited.map((i) => <Text key={i.inviteId} selectable style={s.link}>{`${i.email}  ${i.link}`}</Text>)}
        {result.skipped.map((x) => <Text key={x.email} style={s.dim}>{`${x.email}: ${x.reason}`}</Text>)}
      </View> : null}
      {error ? <Text testID="directory-error" style={s.err}>{error}</Text> : null}
      <Buttons>
        {people.length > 0 && !result ? <Go id="directory-import" label={busy ? "Inviting" : `Invite ${ticked.size} ${ticked.size === 1 ? "person" : "people"}`} onPress={() => { if (ticked.size > 0) void run(); }} /> : null}
        <Go id="directory-open" label="Open People in the Console" ghost onPress={onOpenConsole} />
        <Go id="directory-done" label="Done" ghost onPress={onDone} />
      </Buttons>
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
  person: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: "var(--line)" as string, gap: 2 },
  personOn: { borderColor: "var(--accent)" as string, backgroundColor: "var(--accent-wash)" as string },
  input: { height: 40, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, color: "var(--ink)" as string, fontSize: 14 },
  primary: { height: 34, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  primaryText: { fontSize: 13.5, fontWeight: "500", color: "#fff" },
  ghost: { height: 34, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  ghostText: { fontSize: 13.5, color: "var(--ink)" as string },
});
