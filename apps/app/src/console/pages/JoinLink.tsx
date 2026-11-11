// Console > People > Requests > Request to join: the reusable link. One switch turns it on or off, the address can be copied again any time, the role says who people join as, and Rotate makes a new address
// (the old one stops working). People who open it ask to join with a name and an email; they wait here with Approve and Decline. Approve makes a one-time invite for their email at that role and shows it once.
import { useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Switch } from "../../places/settings/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { emailInvite, endsOn } from "./Invites.tsx";
import { CopyRow } from "./suite/parts.tsx";
import { Actions, Button, Note, Segmented, useAction } from "./shared.tsx";

export type JoinLink = CapMap["members.join_link.get"]["out"]["link"];
export type JoinRequest = CapMap["members.join_requests.list"]["out"]["requests"][number];
type Roles = CapMap["access.roles.list"]["out"]["roles"];

export function JoinLinkSection({ link, requests, roles, roleName, refresh }: { link: JoinLink; requests: JoinRequest[]; roles: Roles; roleName: (id: string) => string; refresh: () => void }): ReactElement {
  const data = useConsoleData();
  const action = useAction(refresh);
  const [rotating, setRotating] = useState(false);
  const [picked, setPicked] = useState("");
  const [copied, setCopied] = useState("");
  const [fresh, setFresh] = useState<{ email: string; link: string } | null>(null);
  const [mailNote, setMailNote] = useState("");
  const choices = roles.filter((r) => r.id !== "rol_owner" && r.id !== "owner" && r.name.toLowerCase() !== "owner");
  const role = picked || link.role;
  const flip = (next: boolean): void => {
    setRotating(false); setCopied("");
    if (next) void action.run("members.join_link.create", { role }, "The link is on.");
    else void action.run("members.join_link.disable", {}, "The link is off.");
  };
  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(link.address ?? ""); setCopied("Copied."); } catch { setCopied("Could not copy. Select the link and copy it."); }
  };
  const pick = (id: string): void => {
    setPicked(id);
    if (link.on && id !== link.role) void action.run("members.join_link.create", { role: id }, `People who ask now join as ${roleName(id)}.`);
  };
  const approve = async (r: JoinRequest): Promise<void> => {
    setMailNote("");
    const out = await action.run<CapMap["members.join_requests.approve"]["out"]>("members.join_requests.approve", { requestId: r.id }, `Approved ${r.name}.`);
    if (out) setFresh({ email: r.email, link: out.link });
  };
  const mail = async (): Promise<void> => {
    if (!fresh) return;
    setMailNote("Sending");
    try { setMailNote((await emailInvite(data.call, { to: fresh.email, link: fresh.link, by: data.me.name, space: data.space.name })) ?? "Connect your own mailbox in Inbox to send from here. Copy the link instead."); }
    catch { setMailNote("Could not send. Copy the link and send it yourself."); }
  };
  return <Section title="Request to join" count={requests.length} testID="console-join-link">
    <Group>
      <Row id="join-link" title="Reusable request link" note={link.on ? (link.address ?? "") : "Turn this on to get a link anyone can open to ask to join. You approve each person."}
        trailing={<Actions>
          {link.on ? <Button label="Copy link" testID="join-copy" disabled={!link.address} onPress={() => void copy()} /> : null}
          {link.on ? <Button label="Rotate" testID="join-rotate" disabled={action.busy} onPress={() => { setRotating(true); setCopied(""); }} /> : null}
          <Switch on={link.on} label="Request to join link" testID="join-switch" disabled={action.busy} onChange={flip} />
        </Actions>} />
      {link.on ? <Row id="join-role" title="Joins as" note="The role a person gets once you approve them." trailing={<Segmented options={choices.map((r) => ({ key: r.id, title: r.name }))} value={role} onChange={pick} />} /> : null}
      {rotating ? <View testID="join-rotate-confirm-box"><Note>The old link stops working.</Note><Actions><Button label="Cancel" testID="join-rotate-cancel" onPress={() => setRotating(false)} /><Button label="Rotate link" danger testID="join-rotate-confirm" disabled={action.busy} onPress={() => void action.run("members.join_link.rotate", {}, "New link made. The old one no longer works.").then(() => setRotating(false))} /></Actions></View> : null}
      {copied ? <Note>{copied}</Note> : null}
      {requests.map((r) => <Row key={r.id} id={`join-request-${r.id}`} title={r.name} note={`${r.email} · Asked ${endsOn(r.at)} · Joins as ${roleName(r.role)}${r.note ? ` · ${r.note}` : ""}`}
        trailing={<Actions>
          <Button label="Deny" testID={`join-decline-${r.id}`} disabled={action.busy} onPress={() => void action.run("members.join_requests.decline", { requestId: r.id }, `Denied ${r.name}.`)} />
          <Button label="Allow" testID={`join-approve-${r.id}`} disabled={action.busy} onPress={() => void approve(r)} />
        </Actions>} />)}
      {link.on && requests.length === 0 ? <Row id="join-none" title="No one has asked to join" note="When someone opens the link and asks, they show up here." /> : null}
      {fresh ? <><Note>{`Copy this one-time invite link for ${fresh.email}:`}</Note><CopyRow label="Link, works once" value={fresh.link} testID="join-approved-link" /><Actions><Button label={`Email it to ${fresh.email}`} testID="join-approved-mail" disabled={mailNote === "Sending"} onPress={() => void mail()} /><Button label="Done" testID="join-approved-done" onPress={() => { setFresh(null); setMailNote(""); }} /></Actions>{mailNote ? <Note>{mailNote}</Note> : null}</> : null}
      {action.note ? <Note>{action.note}</Note> : null}
    </Group>
  </Section>;
}

