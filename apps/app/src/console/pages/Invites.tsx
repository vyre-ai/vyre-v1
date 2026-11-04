// Console > People: the invites still open, and what an owner or admin does with one. Each row says who it is for, the role and when it ends. A new link takes the old one back first (the code is shown
// once and kept only as a hash, so the only way to send it again is a fresh one), then makes the same invite again. Revoking stops the link at once; a person who opens it is told it has ended.
import { useState } from "react";
import type { ReactElement } from "react";
import { Text } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { draftInvites, ownMailbox, sendDrafts } from "../../onboarding/suite.ts";
import type { SendOutcome } from "../../onboarding/suite.ts";
import { Actions, Button, Note, attempt, useAction, useRead } from "./shared.tsx";

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

export function OpenInvites({ roleName }: { roleName: (id: string) => string }): ReactElement | null {
  const data = useConsoleData();
  const invites = useRead<CapMap["members.invites.list"]["out"]>("members.invites.list", { state: "open" });
  const action = useAction(invites.refresh);
  const [confirm, setConfirm] = useState<Invite | null>(null);
  const [fresh, setFresh] = useState<{ id: string; link: string; email?: string } | null>(null);
  const [mailNote, setMailNote] = useState("");
  if (!invites.data) return null;
  const rows = invites.data.invites;
  if (rows.length === 0 && !fresh && !action.note) return null;
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
  return <Section title="Invites" count={rows.length} testID="console-invites">
    <Group>
      {rows.map((inv) => <Row key={inv.id} id={`console-invite-${inv.id}`} title={inv.email ?? "Invite link"} note={`${roleName(inv.role)} · Ends ${endsOn(inv.expiresAt)}`}
        trailing={<Actions><Button label="New link" testID={`console-invite-again-${inv.id}`} disabled={action.busy} onPress={() => void again(inv)} /><Button label="Revoke" danger testID={`console-invite-revoke-${inv.id}`} disabled={action.busy} onPress={() => setConfirm(inv)} /></Actions>} />)}
      {confirm ? <><Note>{confirm.email ? `Revoke the invite for ${confirm.email}?` : "Revoke this invite?"} The link stops working.</Note><Actions><Button label="Cancel" onPress={() => setConfirm(null)} /><Button label="Revoke invite" danger testID="console-invite-revoke-confirm" disabled={action.busy} onPress={() => void action.run("members.invites.revoke", { inviteId: confirm.id }, "Invite revoked.").then(() => setConfirm(null))} /></Actions></> : null}
      {fresh ? <><Note>Copy this one-time invite link:</Note><Text selectable testID="console-invite-fresh-link">{fresh.link}</Text>{fresh.email ? <Actions><Button label={`Email it to ${fresh.email}`} testID="console-invite-fresh-mail" disabled={mailNote === "Sending"} onPress={() => void mail()} /></Actions> : null}{mailNote ? <Note>{mailNote}</Note> : null}</> : null}
      {action.note ? <Note>{action.note}</Note> : null}
    </Group>
  </Section>;
}
