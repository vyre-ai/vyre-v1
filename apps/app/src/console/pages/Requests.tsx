// Console > People > Requests: the invites still open (Copy link is a New link, since a code is shown once; Revoke stops it), the reusable Request to join link with the people who asked through it, and the people who asked for access, each with Approve and Decline.
// The line at the top says how many asked. The shell adds the Needs you strip for alerts.
import { useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { useObjectNames } from "../objects/names.ts";
import { Group, Section } from "../shell/ui.tsx";
import { InviteSheet, OpenInvites } from "./Invites.tsx";
import { JoinLinkSection } from "./JoinLink.tsx";
import { Actions, Button, Note, ReadState, useAction, useRead } from "./shared.tsx";

type Asked = CapMap["access.requests.list"]["out"]["requests"][number];
type Roles = CapMap["access.roles.list"]["out"];

/** The line above the page: "1 person asked for access" (null when nobody waits). */
export const askedLine = (n: number): string | null => n === 0 ? null : `${n} ${n === 1 ? "person asked" : "people asked"} for access`;

export function RequestsPage(): ReactElement {
  const roles = useRead<Roles>("access.roles.list");
  const asked = useRead<CapMap["access.requests.list"]["out"]>("access.requests.list", { state: "waiting" });
  const joinLink = useRead<CapMap["members.join_link.get"]["out"]>("members.join_link.get");
  const joinAsked = useRead<CapMap["members.join_requests.list"]["out"]>("members.join_requests.list", { state: "waiting" });
  const [inviting, setInviting] = useState(false);
  const [rev, setRev] = useState(0);
  const action = useAction(asked.refresh);
  const waiting: Asked[] = asked.data?.requests ?? [];
  const names = useObjectNames({ identities: waiting.map((r) => ({ kind: "person", id: r.requester })), resources: waiting.map((r) => r.resource) });
  if (!roles.data) return <ReadState error={roles.error} retry={roles.refresh} />;
  const roleName = (id: string): string => roles.data?.roles.find((r) => r.id === id)?.name ?? "Role";
  const joining = joinAsked.data?.requests ?? [];
  const line = askedLine(waiting.length + joining.length);
  return <View testID="console-requests">
    {line ? <Group testID="requests-asked"><Row id="requests-asked-line" title={line} note="Approve or decline below." /></Group> : null}
    <OpenInvites key={rev} roleName={roleName} showEmpty right={<Button label="New invite" testID="newinvite" onPress={() => setInviting(true)} />} />
    {joinLink.data ? <JoinLinkSection link={joinLink.data.link} requests={joining} roles={roles.data.roles} roleName={roleName} refresh={() => { joinLink.refresh(); joinAsked.refresh(); }} /> : null}
    <Section title="Asked for access" count={waiting.length} testID="requests-list">
      <Group>
        {waiting.map((r) => <Row key={r.id} id={`request-${r.id}`} title={names.identity({ kind: "person", id: r.requester })} note={`Wants ${r.level} access to ${names.resource(r.resource)} · ${new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}${r.note ? ` · ${r.note}` : ""}`}
          trailing={<Actions>
            <Button label="Deny" testID={`request-decline-${r.id}`} disabled={action.busy} onPress={() => void action.run("access.requests.decline", { requestId: r.id }, "Denied.")} />
            <Button label="Allow" testID={`request-approve-${r.id}`} disabled={action.busy} onPress={() => void action.run("access.requests.approve", { requestId: r.id, level: r.level }, "Allowed.")} />
          </Actions>} />)}
        {waiting.length === 0 ? <Row id="requests-none" title="No one is waiting" note="When someone asks for access, you can approve it here." /> : null}
      </Group>
      {action.note ? <Note>{action.note}</Note> : null}
    </Section>
    {inviting ? <InviteSheet onClose={() => setInviting(false)} onCreated={() => setRev((n) => n + 1)} /> : null}
  </View>;
}
