import { useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Section, Group } from "../shell/ui.tsx";
import { Actions, Button, Note, ReadState, useAction, useRead } from "./shared.tsx";

type List = CapMap["devices.list"]["out"];
export function Devices(): ReactElement {
  const list = useRead<List>("devices.list");
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "device" | "session"; id: string } | null>(null);
  const action = useAction(list.refresh);
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const rows: ReactElement[] = [];
  for (const device of list.data.devices) rows.push(<Row key={device.id} id={`console-device-${device.id}`} title={device.name} note={`${device.class} · ${device.revokedAt ? "Revoked" : device.current ? "Current device" : device.lastSeenAt ? `Last seen ${new Date(device.lastSeenAt).toLocaleString()}` : "Not seen yet"}`} onPress={() => setSelected(device.id)} trailing={!device.revokedAt ? <Button label="Revoke…" danger disabled={action.busy} onPress={() => setConfirm({ kind: "device", id: device.id })} /> : null} />);
  return <View testID="console-devices"><Section title="Sessions and devices" count={rows.length}><Group>{rows.length ? rows : <Note>No devices.</Note>}</Group></Section>{selected ? <DeviceSessions key={selected} deviceId={selected} onRevoke={(id) => setConfirm({ kind: "session", id })} /> : null}{confirm ? <Section title="Confirm revocation"><Note>{confirm.kind === "device" ? "This device’s sessions end and it purges its local copy on next contact." : "This session ends at once."}</Note><Actions><Button label="Cancel" onPress={() => setConfirm(null)} /><Button label="Confirm revoke" danger testID="console-revoke-confirm" disabled={action.busy} onPress={() => void action.run(confirm.kind === "device" ? "devices.revoke" : "devices.sessions.revoke", confirm.kind === "device" ? { deviceId: confirm.id } : { sessionId: confirm.id }, "Revoked").then((out) => { if (out) { setConfirm(null); setSelected(null); } })} /></Actions></Section> : null}{action.note ? <Note>{action.note}</Note> : null}</View>;
}
function DeviceSessions({ deviceId, onRevoke }: { deviceId: string; onRevoke: (id: string) => void }): ReactElement {
  const detail = useRead<CapMap["devices.get"]["out"]>("devices.get", { deviceId });
  if (!detail.data) return <ReadState error={detail.error} retry={detail.refresh} />;
  const rows: ReactElement[] = [];
  for (const session of detail.data.sessions) rows.push(<Row key={session.id} id={`console-session-${session.id}`} title={session.current ? "Current session" : new Date(session.startedAt).toLocaleString()} note={`${session.kind} · Last seen ${new Date(session.lastSeenAt).toLocaleString()}`} trailing={<Button label="End session…" danger onPress={() => onRevoke(session.id)} />} onPress={() => onRevoke(session.id)} />);
  return <Section title={detail.data.device.name}><Group>{rows.length ? rows : <Note>No active sessions.</Note>}</Group></Section>;
}
