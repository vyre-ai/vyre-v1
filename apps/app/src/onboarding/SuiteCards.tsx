import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { connections, createInviteLink, directory, draftInvites, importable, importPeople, invites, memberRoleId, ownMailbox, sendDrafts, ssoProviders, ssoWorks, ssoLine, stepDoneBy, testSso } from "./suite.ts";
import type { DirectoryPage, DirectoryPerson, ImportResult, MailSender, Probe, SendOutcome } from "./suite.ts";

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
      {/* ui-rows-lint: not a list (two status lines of text, not list rows) */}
      {c === null ? <Text style={s.dim}>Checking</Text> : rows.map((p, i) => <Text key={i} testID={`workspace-${i === 0 ? "google" : "microsoft"}`} style={s.dim}>{p.kind === "ready" ? `${p.value.name}: ${p.value.note}` : `${i === 0 ? "Google Workspace" : "Microsoft 365"}: ${line(p, "")}`}</Text>)}
      <Buttons><Go id="workspace-open" label="Open the setup in the Console" onPress={onOpenConsole} />{c && stepDoneBy(c) ? <Go id="workspace-done" label="Done" ghost onPress={onDone} /> : null}</Buttons>
    </View>
  );
}

export function SignInDomainCard({ call, onOpenConsole, onDone }: { call: CapCall; onOpenConsole(): void; onDone(): void }): ReactElement {
  const [p, setP] = useState<Awaited<ReturnType<typeof ssoProviders>> | null>(null);
  const [tested, setTested] = useState<Record<string, string>>({});
  useEffect(() => { let off = false; void ssoProviders(call).then((r) => { if (!off) setP(r); }); return () => { off = true; }; }, [call]);
  const list = p?.kind === "ready" ? p.value : [];
  return (
    <View testID="signin-domain-card" style={s.col}>
      <Text style={s.line}>Let people sign in with their work account for your domain, in the same app. Only existing members and people with an accepted invite can sign in.</Text>
      {p === null ? <Text style={s.dim}>Checking</Text> : p.kind !== "ready" ? <Text style={s.dim}>{line(p, "")}</Text> : list.length === 0 ? <Text testID="signin-none" style={s.dim}>Not turned on yet. Set up Google or Microsoft in the Console.</Text> : list.map((x) => (
        <View key={x.key} style={s.col}>
          <Text testID={`sso-${x.key}`} style={s.dim}>{ssoLine(x)}</Text>
          <Buttons><Go id={`sso-test-${x.key}`} label="Test it" ghost onPress={() => void testSso(call, x.key).then((r) => setTested((t) => ({ ...t, [x.key]: r.ok ? "The test passed." : r.detail ?? "The test did not pass." })))} />{tested[x.key] ? <Text style={s.dim}>{tested[x.key]}</Text> : null}</Buttons>
        </View>
      ))}
      <Buttons><Go id="signin-open" label="Open sign-in settings" onPress={onOpenConsole} />{list.some(ssoWorks) ? <Go id="signin-done" label="Done" ghost onPress={onDone} /> : <Go id="signin-done" label="Skip" ghost onPress={onDone} />}</Buttons>
    </View>
  );
}

export function DirectoryCard({ call, by, space, onOpenConsole, onDone }: { call: CapCall; /** who is inviting, for the email */ by: string; space: string; onOpenConsole(): void; onDone(): void }): ReactElement {
  const attempt = useRef(0);
  const [people, setPeople] = useState<DirectoryPerson[] | null>(null);
  const [next, setNext] = useState<DirectoryPage["next"]>({});
  const [state, setState] = useState<"loading" | "ready" | "not_yet" | "failed">("loading");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [sender, setSender] = useState<MailSender | null | undefined>(undefined);
  const [sent, setSent] = useState<SendOutcome[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async (from?: DirectoryPage["next"]): Promise<void> => {
    const r = await directory(call, from);
    if (r.kind !== "ready") { if (!from) setState(r.kind); return; }
    setState("ready"); setNext(r.value.next);
    setPeople((cur) => [...(from ? cur ?? [] : []), ...r.value.people]);
  };
  useEffect(() => { void load(); }, [call]);
  const shown = people ? importable(people) : [];
  const more = Boolean(next.google || next.microsoft);
  const toggle = (email: string): void => setTicked((t) => { const n = new Set(t); if (n.has(email)) n.delete(email); else n.add(email); return n; });
  const run = async (): Promise<void> => {
    if (busy || ticked.size === 0) return;
    setBusy(true); setError("");
    try {
      setResult(await importPeople(call, shown.filter((p) => ticked.has(p.email)), await memberRoleId(call), `onb-import-${Date.now()}-${attempt.current++}`));
      setSender(await ownMailbox(call));
    } catch { setError("Could not bring these people in. Try again."); } finally { setBusy(false); }
  };
  const names = new Map((people ?? []).filter((p) => p.name).map((p) => [p.email, p.name!] as const));
  const drafts = result ? draftInvites(result.invited, names, by, space) : [];
  const send = async (): Promise<void> => {
    if (busy || !sender) return;
    setBusy(true);
    try { setSent(await sendDrafts(call, sender, drafts, `onb-mail-${Date.now()}-${attempt.current++}`)); } finally { setBusy(false); }
  };
  return (
    <View testID="directory-card" style={s.col}>
      <Text style={s.line}>Tick the people to bring in. Each gets an invite as a Member. Nothing is sent until you press send on the drafts below.</Text>
      {state === "loading" ? <Text style={s.dim}>Checking</Text> : state !== "ready" ? <Text testID="directory-status" style={s.dim}>{state === "not_yet" ? NOT_YET : "Could not read this right now."}</Text> : shown.length === 0 ? <Text testID="directory-status" style={s.dim}>Everyone in your directory is already here.</Text> : (
        <View style={s.col}>
          {shown.map((p) => (
            <Pressable key={p.email} testID={`dir-${p.email}`} accessibilityRole="checkbox" accessibilityState={{ checked: ticked.has(p.email) }} onPress={() => toggle(p.email)} style={[s.person, ticked.has(p.email) && s.personOn]}>
              <Text style={s.line}>{p.name ?? p.email}</Text><Text style={s.dim}>{p.name ? p.email : p.source === "google" ? "Google" : "Microsoft"}</Text>
            </Pressable>
          ))}
          {more ? <Go id="directory-more" label="Show more people" ghost onPress={() => void load(next)} /> : null}
        </View>
      )}
      {result ? (
        <View testID="directory-result" style={s.col}>
          <Text style={s.dim}>{`${result.invited.length} invited${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}.`}</Text>
          {sent ? <Text testID="directory-sent" style={s.dim}>{sent.map((x) => `${x.to}: ${x.status === "queued" || x.status === "sent" ? "sent" : x.status === "held" ? "held for approval" : x.status === "suppressed" ? "not sent (suppressed)" : "failed"}`).join(". ")}</Text> : drafts.length > 0 ? (
            <View style={s.col}>
              <Text style={s.line}>{sender ? `Email these invites from ${sender.address}. One email per person, with their link.` : "Connect your mailbox to email these invites. Until then, share each link yourself."}</Text>
              {drafts.map((d) => <View key={d.to} testID="invite-draft" style={s.person}><Text style={s.line}>{`To ${d.to}`}</Text><Text style={s.dim}>{d.subject}</Text></View>)}
              {sender ? <Go id="directory-email" label={busy ? "Sending" : `Send ${drafts.length} ${drafts.length === 1 ? "email" : "emails"}`} onPress={() => void send()} /> : null}
            </View>
          ) : null}
          <Text style={s.dim}>The links, if you would rather share them yourself:</Text>
          {result.invited.map((i) => <Text key={i.inviteId} selectable style={s.link}>{`${i.email}  ${i.link}`}</Text>)}
          {result.skipped.map((x) => <Text key={x.email} style={s.dim}>{`${x.email}: ${x.reason}`}</Text>)}
        </View>
      ) : null}
      {error ? <Text testID="directory-error" style={s.err}>{error}</Text> : null}
      <Buttons>
        {shown.length > 0 && !result ? <Go id="directory-import" label={busy ? "Inviting" : `Invite ${ticked.size} ${ticked.size === 1 ? "person" : "people"}`} onPress={() => void run()} /> : null}
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
