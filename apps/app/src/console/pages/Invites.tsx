// Console > People: the invites still open, and what an owner or admin does with one. Each row says who it is for, the role and when it ends. A new link takes the old one back first (the code is shown
// once and kept only as a hash, so the only way to send it again is a fresh one), then makes the same invite again. Revoking stops the link at once; a person who opens it is told it has ended.
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Text } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { draftInvites, ownMailbox, sendDrafts } from "../../onboarding/suite.ts";
import type { SendOutcome } from "../../onboarding/suite.ts";
import { CopyRow } from "./suite/parts.tsx";
import { Actions, Button, Field, FormSheet, Note, Select, attempt, useAction, useRead } from "./shared.tsx";
import { EMPTY_START, InviteStart, startInput } from "./InviteStart.tsx";
import type { StartSet } from "./InviteStart.tsx";

type Invite = CapMap["members.invites.list"]["out"]["invites"][number];

/** How long a new invite lasts. */
export const EXPIRY_CHOICES = [{ key: "1", title: "1 day" }, { key: "7", title: "7 days" }, { key: "30", title: "30 days" }] as const;

export const endsOn = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** What one send by email came to, in a line. */
export function sentLine(to: string, status: SendOutcome["status"]): string {
  return status === "sent" || status === "queued" ? `Sent to ${to}.` : status === "held" ? `Waiting for approval before it goes to ${to}.` : status === "suppressed" ? `${to} asked not to get email. Copy the link and send it another way.` : `Could not send to ${to}. Copy the link and send it yourself.`;
}

/** Send one invite link from the person's own mailbox, through the Space's one send path (its rules and the Gate apply). Null: they have no working mailbox here. */
export async function emailInvite(call: (cap: string, input: unknown) => Promise<unknown>, o: { to: string; link: string; by: string; space: string }): Promise<string | null> {
  const from = await ownMailbox(call as never);
  if (!from) return null;
  const [out] = await sendDrafts(call as never, from, draftInvites([{ email: o.to, link: o.link }], new Map(), o.by, o.space), `invite-mail-${attempt()}`);
  return sentLine(o.to, out?.status ?? "failed");
}

/** The one invite flow (People > Members "Invite people" and Requests "New invite"): a sheet that makes the link, then shows it once with an email option. */
export function InviteSheet({ onClose, onCreated }: { onClose: () => void; onCreated?: () => void }): ReactElement | null {
  const data = useConsoleData();
  const roles = useRead<CapMap["access.roles.list"]["out"]>("access.roles.list");
  const groups = useRead<CapMap["access.groups.list"]["out"]>("access.groups.list", {});
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [link, setLink] = useState("");
  const [days, setDays] = useState("7");
  const [start, setStart] = useState<StartSet>(EMPTY_START);
  const [mailNote, setMailNote] = useState("");
  const action = useAction(() => undefined);
  if (!roles.data || !groups.data) return null;
  const inviteRoles = roles.data.roles.filter((r) => r.id !== "rol_owner" && r.id !== "owner" && r.name.toLowerCase() !== "owner");
  const chosenRole = role || inviteRoles.find((r) => r.name === "Member")?.id || inviteRoles[0]?.id || "";
  const submit = (): void => {
    if (link) { onClose(); return; }
    void action.run<CapMap["members.invites.create"]["out"]>("members.invites.create", { role: chosenRole, ...(email.trim() ? { email: email.trim() } : {}), ...startInput(start), expiresInDays: Number(days), idempotencyKey: attempt() }, "Invite created").then((out) => { if (out) { setLink(out.link); onCreated?.(); } });
  };
  return <FormSheet title="Invite people" testID="invite-sheet" onClose={onClose} submit={link ? "Done" : "Create invite"} disabled={!link && (!chosenRole || action.busy)} why={!chosenRole ? "Pick a role first" : undefined} onSubmit={submit}>
    {link ? <><Note>Copy this one-time invite link:</Note><CopyRow label="Link, works once" value={link} testID="console-invite-link" />
      {email.trim() ? <Actions><Button label={`Email it to ${email.trim()}`} testID="console-invite-mail" disabled={mailNote === "Sending"} onPress={() => { setMailNote("Sending"); void emailInvite(data.call, { to: email.trim(), link, by: data.me.name, space: data.space.name }).then((line) => setMailNote(line ?? "Connect your own mailbox in Inbox to send from here. Copy the link instead."), () => setMailNote("Could not send. Copy the link and send it yourself.")); }} /></Actions> : null}
      {mailNote ? <Note>{mailNote}</Note> : null}</>
      : <><Field label="Email (optional)" testID="console-invite-email" value={email} onChange={setEmail} /><Select label="Role" value={chosenRole} options={inviteRoles.map((r) => ({ key: r.id, title: r.name }))} onChange={setRole} /><Select label="Ends after" value={days} options={EXPIRY_CHOICES} onChange={setDays} /><InviteStart value={start} onChange={setStart} groups={groups.data.groups} /></>}
    {action.note && !link ? <Note>{action.note}</Note> : null}
  </FormSheet>;
}

export function OpenInvites({ roleName, showEmpty = false, right }: { roleName: (id: string) => string; showEmpty?: boolean; right?: ReactNode }): ReactElement | null {
  const data = useConsoleData();
  const invites = useRead<CapMap["members.invites.list"]["out"]>("members.invites.list", { state: "open" });
  const action = useAction(invites.refresh);
  const [confirm, setConfirm] = useState<Invite | null>(null);
  const [fresh, setFresh] = useState<{ id: string; link: string; email?: string } | null>(null);
  const [mailNote, setMailNote] = useState("");
  if (!invites.data) return null;
  const rows = invites.data.invites;
  if (rows.length === 0 && !fresh && !action.note) return showEmpty ? <Section title="Invites" count={0} right={right} testID="console-invites"><Group><Row id="console-invites-none" title="No open invites" note="Invite people to give them a link that works once." /></Group></Section> : null;
  const again = async (inv: Invite): Promise<void> => {
    setMailNote("");
    const gone = await action.run("members.invites.revoke", { inviteId: inv.id }, "");
    if (gone === undefined) return;
    const days = Math.max(1, Math.min(90, Math.round((inv.expiresAt - inv.createdAt) / 86_400_000)));
    const out = await action.run<CapMap["members.invites.create"]["out"]>("members.invites.create", {
      role: inv.role, ...(inv.email ? { email: inv.email } : {}), groups: inv.groups, agents: inv.agents, projects: inv.projects, channels: inv.channels, expiresInDays: days, idempotencyKey: attempt(),
    }, "New link made. The old one no longer works.");
    if (out) setFresh({ id: out.invite.id, link: out.link, ...(inv.email ? { email: inv.email } : {}) });
  };
  const mail = async (): Promise<void> => {
    if (!fresh?.email) return;
    setMailNote("Sending");
    try { setMailNote((await emailInvite(data.call, { to: fresh.email, link: fresh.link, by: data.me.name, space: data.space.name })) ?? "Connect your own mailbox in Inbox to send from here. Copy the link instead."); }
    catch { setMailNote("Could not send. Copy the link and send it yourself."); }
  };
  return <Section title="Invites" count={rows.length} right={right} testID="console-invites">
    <Group>
      {rows.map((inv) => <Row key={inv.id} id={`console-invite-${inv.id}`} title={inv.email ?? "Invite link"} note={`${roleName(inv.role)} · Ends ${endsOn(inv.expiresAt)}`}
        trailing={<Actions><Button label="New link" testID={`console-invite-again-${inv.id}`} disabled={action.busy} onPress={() => void again(inv)} /><Button label="Revoke" danger testID={`console-invite-revoke-${inv.id}`} disabled={action.busy} onPress={() => setConfirm(inv)} /></Actions>} />)}
      {confirm ? <><Note>{confirm.email ? `Revoke the invite for ${confirm.email}?` : "Revoke this invite?"} The link stops working.</Note><Actions><Button label="Cancel" onPress={() => setConfirm(null)} /><Button label="Revoke invite" danger testID="console-invite-revoke-confirm" disabled={action.busy} onPress={() => void action.run("members.invites.revoke", { inviteId: confirm.id }, "Invite revoked.").then(() => setConfirm(null))} /></Actions></> : null}
      {fresh ? <><Note>Copy this one-time invite link:</Note><CopyRow label="Link, works once" value={fresh.link} testID="console-invite-fresh-link" />{fresh.email ? <Actions><Button label={`Email it to ${fresh.email}`} testID="console-invite-fresh-mail" disabled={mailNote === "Sending"} onPress={() => void mail()} /></Actions> : null}{mailNote ? <Note>{mailNote}</Note> : null}</> : null}
      {action.note ? <Note>{action.note}</Note> : null}
    </Group>
  </Section>;
}
