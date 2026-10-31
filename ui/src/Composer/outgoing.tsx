// The header of a composer whose message leaves Vyre (rc.8 composer: Inbox email and text, Ask-for-these drafts). To with the Email and Text switch beside it, From as a picker
// that lists every sender with its service's logo, name and address grouped by service (and the way to connect another), and Subject for email only.
import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { TextStyle } from "react-native";
import { Row } from "../Row/index.tsx";
import { GroupHead, I, IconTile, LogoTile, Pop, useDismiss } from "./parts.tsx";
import { Glyph } from "./shared.tsx";

export type OutChannel = "email" | "text";

/** One way a message can go out: a mailbox, a sending domain or a phone number. Mirrors comms.senders.list. */
export interface ComposerSender {
  id: string;
  channel: OutChannel;
  /** The name the person gave it ("Irfad at MLA"), else the address. */
  name: string;
  address: string;
  /** The service it goes through, as people know it: Gmail, Outlook, Mailgun, Resend, Twilio. */
  via: string;
  /** The service's id, for its logo. */
  provider?: string;
  default?: boolean;
  /** False: listed, but it cannot send now; `why` says why. */
  usable?: boolean;
  why?: string;
}

export interface SenderGroup { via: string; provider?: string; items: ComposerSender[] }

/** Senders of one channel grouped by service, in the order the services first appear. */
export function groupSenders(senders: readonly ComposerSender[], channel: OutChannel): SenderGroup[] {
  const out: SenderGroup[] = [];
  for (const x of senders) {
    if (x.channel !== channel) continue;
    let g = out.find((y) => y.via === x.via);
    if (!g) { g = { via: x.via, ...(x.provider ? { provider: x.provider } : {}), items: [] }; out.push(g); }
    g.items.push(x);
  }
  return out;
}

export const CONNECT_LABEL: Record<OutChannel, { title: string; note: string }> = {
  email: { title: "Connect a mailbox or sending domain", note: "Gmail, Outlook, Mailgun, Resend, SMTP" },
  text: { title: "Connect a number", note: "Twilio and others" },
};

export interface OutgoingProps {
  channel: OutChannel;
  /** Channels this contact can be reached on; the other one shows switched off. */
  channels: readonly OutChannel[];
  onChannel(c: OutChannel): void;
  /** The To field: ui/Recipients for email, the number for a text. */
  to: ReactNode;
  senders: readonly ComposerSender[];
  senderId: string | null;
  onSender(id: string): void;
  /** Opens the connect sheet in place for this channel. Left out: no connect row. */
  onConnect?(channel: OutChannel): void;
  subject?: string;
  onSubject?(t: string): void;
  testID?: string;
}

export function OutgoingHeader(p: OutgoingProps): ReactElement {
  const [open, setOpen] = useState(false);
  const box = useRef<unknown>(null);
  useDismiss(open, () => setOpen(false), () => [box.current as never]);
  const list = p.senders.filter((x) => x.channel === p.channel);
  const from = list.find((x) => x.id === p.senderId) ?? null;
  const groups = groupSenders(p.senders, p.channel);
  const mail = p.channel === "email";
  return (
    <View style={o.out} testID={p.testID ?? "composer-outgoing"} ref={box as never}>
      <View style={o.line}>
        <Text style={o.k}>To</Text>
        <View style={o.v}>{p.to}</View>
        {p.channels.length > 0 ? (
          <View style={o.seg} accessibilityRole="tablist" testID="out-channel">
            {/* ui-rows-lint: not a list (the Email and Text segmented switch) */}
            {(["email", "text"] as const).map((c) => (
              <Pressable key={c} accessibilityRole="tab" accessibilityState={{ selected: c === p.channel, disabled: !p.channels.includes(c) }} aria-selected={c === p.channel} disabled={!p.channels.includes(c)} accessibilityLabel={c === "email" ? "Email" : "Text"} testID={`chan-${c}`} onPress={() => p.onChannel(c)} style={[o.segBtn, c === p.channel && o.segOn, !p.channels.includes(c) && o.dim]}>
                <Text style={[o.segText, c === p.channel && o.segTextOn]}>{c === "email" ? "Email" : "Text"}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      <View style={o.line}>
        <Text style={o.k}>From</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={mail ? "Send from" : "Text from"} testID="from-pick" onPress={() => setOpen((x) => !x)} style={({ hovered }: { hovered?: boolean }) => [o.from, (hovered === true || open) && o.hover]}>
          {from ? <LogoTile provider={from.provider ?? from.via} name={from.via} size={20} /> : null}
          <Text numberOfLines={1} style={o.fromName} testID="from-name">{from ? from.name : mail ? "No mailbox can send" : "No number can send"}</Text>
          {from ? <Text numberOfLines={1} style={o.fromAddr}>{from.address}</Text> : null}
          <Glyph icon={I.chev} native="▾" size={12} color="var(--ink-3)" />
        </Pressable>
      </View>
      {mail && p.onSubject ? (
        <View style={o.line}>
          <Text style={o.k}>Subject</Text>
          <TextInput accessibilityLabel="Subject" placeholder="Subject" placeholderTextColor="var(--ink-4)" value={p.subject ?? ""} onChangeText={p.onSubject} testID="contact-subject" style={[o.subject, FIELD]} />
        </View>
      ) : null}
      <View style={o.sep} />
      {open ? (
        <Pop testID="from-menu" label={mail ? "Send from" : "Text from"} style={o.pop}>
          <View style={o.scr}>
            {/* ui-rows-lint: not a list (group wrappers with a heading; each sender inside is a Row) */}
            {groups.map((g) => (
              <View key={g.via}>
                <GroupHead label={g.via} />
                {g.items.map((x) => {
                  const on = x.id === p.senderId;
                  const ok = x.usable !== false;
                  return (
                    <Row key={x.id} id={`from-${x.id}`} title={x.name} note={ok ? x.address : `${x.address} · ${x.why ?? "Cannot send now"}`} selected={on}
                      leading={<View style={o.lead}><LogoTile provider={x.provider ?? x.via} name={x.via} size={24} /></View>}
                      {...(on ? { trailing: <Glyph icon={I.check} native="✓" size={14} color="var(--accent)" /> } : {})}
                      {...(ok ? { onPress: () => { p.onSender(x.id); setOpen(false); } } : {})}
                      domProps={{ style: { minHeight: 40, opacity: ok ? 1 : 0.5 } }}
                    />
                  );
                })}
              </View>
            ))}
            {p.onConnect ? (
              <View>
                <GroupHead label="Add" />
                <Row id="from-connect" title={CONNECT_LABEL[p.channel].title} note={CONNECT_LABEL[p.channel].note} leading={<View style={o.lead}><IconTile icon={I.plus} size={24} /></View>} onPress={() => { setOpen(false); p.onConnect?.(p.channel); }} domProps={{ style: { minHeight: 40 } }} />
              </View>
            ) : null}
          </View>
        </Pop>
      ) : null}
    </View>
  );
}

const FIELD = { outlineStyle: "none", outlineWidth: 0, backgroundColor: "transparent", borderWidth: 0 } as unknown as TextStyle;

const o = StyleSheet.create({
  out: { position: "relative", zIndex: 5, paddingTop: 2, gap: 6 },
  line: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 26 },
  k: { width: 52, fontSize: 13, color: "var(--ink-3)" as string },
  v: { flex: 1, minWidth: 0 },
  seg: { flexDirection: "row", padding: 2, borderRadius: 9, backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  segBtn: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 7 },
  segOn: { backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-1)" } as object,
  segText: { fontSize: 12, color: "var(--ink-3)" as string },
  dim: { opacity: 0.4 },
  segTextOn: { color: "var(--ink)" as string, fontWeight: "500" },
  from: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3, paddingLeft: 4, paddingRight: 8, borderRadius: 9, minWidth: 0, flexShrink: 1 },
  hover: { backgroundColor: "var(--hover)" as string },
  fromName: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  fromAddr: { fontSize: 13, color: "var(--ink-3)" as string, flexShrink: 1 },
  subject: { flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string, padding: 0 },
  sep: { height: 1, backgroundColor: "var(--line)" as string, marginTop: 2 },
  pop: { bottom: "100%", marginBottom: 12, left: 40, width: 340, maxWidth: "100%" } as object,
  scr: { padding: 6, maxHeight: 360, overflow: "scroll" } as object,
  lead: { marginRight: 10 },
});
