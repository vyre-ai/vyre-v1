// Mount for P-L9_08: ?part=dialer, incoming, live, ended (the Softphone) and ?part=terminal, locked (the Terminal).
// Every control works: the dial pad types, Call dials, mute and hold toggle, the transfer menu opens, the terminal clears and copies.
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { CallBar, CallPane, Softphone } from "../../../ui/src/Softphone/index.tsx";
import type { SoftphoneProps } from "../../../ui/src/Softphone/index.tsx";
import { Terminal } from "../../../ui/src/Terminal/index.tsx";

export const title = "Softphone and Terminal";

const NUMBERS = [
  { id: "n1", label: "Irfad", num: "+1 415 555 0132" },
  { id: "n2", label: "Intake line", num: "+1 415 555 0177" },
];

const CALLER = { name: "Elena Rivera", number: "+1 415 555 0161", company: "Northwind Holdings", recordId: "rec_elena" };

const TARGETS = [
  { name: "Maya Chen", kind: "teammate" as const },
  { name: "Omar Haddad", kind: "teammate" as const },
  { name: "Intake", kind: "agent" as const },
  { name: "Billing", kind: "agent" as const },
];

const OUTPUT = [
  "\x1b[2mLast login: Sat Oct 24 09:12:40 on ttys001\x1b[0m",
  "",
  "\x1b[2m$ git status\x1b[0m",
  "On branch intake/rivera-forms",
  "Your branch is up to date with 'origin/intake/rivera-forms'.",
  "",
  "Changes not staged for commit:",
  "  \x1b[31mmodified:   forms/rivera-intake.json\x1b[0m",
  "  \x1b[31mmodified:   notes/call-2024-10-23.md\x1b[0m",
  "",
  "\x1b[2m$ vyre records get rivera\x1b[0m",
  "\x1b[32m✓\x1b[0m Rivera matter \x1b[2m(Lead, fit 4)\x1b[0m",
  "\x1b[32mintake\x1b[0m@intake-mini \x1b[35m~/Rivera-intake\x1b[0m \x1b[2m$\x1b[0m ",
].join("\r\n");

function Live({ withPane }: { withPane: boolean }) {
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [recording, setRecording] = useState(false);
  const props: SoftphoneProps = { open: true, mode: held ? "held" : "live", numbers: NUMBERS, caller: CALLER, muted, held, recording, consent: recording, transferTargets: TARGETS };
  return (
    <View style={{ width: "100%" }}>
      <CallBar {...props} secs={134} onMute={() => setMuted((v) => !v)} onHold={() => setHeld((v) => !v)} onRecord={() => setRecording((v) => !v)} />
      {withPane ? (
        <CallPane
          caller={CALLER}
          notes=""
          recording={recording}
          consent={recording}
          card={{ last: [{ kind: "mail", text: "Engagement letter sent", when: "Mon" }, { kind: "sms", text: "Can we move the signing?", when: "Tue" }, { kind: "call", text: "Call 04:12", when: "Last week" }], tasks: [{ title: "Send intake form", due: "Today" }, { title: "Review lease", due: "Fri" }] }}
        />
      ) : null}
    </View>
  );
}

export default function Mount() {
  const { part = "dialer" } = useLocalSearchParams<{ part?: string }>();
  const frame = { flex: 1, padding: 16 } as const;
  if (part === "incoming") {
    return <View style={frame}><Softphone placement="inline" open mode="incoming" numbers={NUMBERS} fromId="n2" caller={CALLER} /></View>;
  }
  if (part === "live") return <View style={{ flex: 1 }}><Live withPane /></View>;
  if (part === "ended") {
    return (
      <View style={frame}>
        <Softphone
          placement="inline" open mode="ended" numbers={NUMBERS} caller={CALLER} endedSecs={134}
          summary="Elena sends the lease Thursday and asks to move signing to the 30th. You will send her a new time today."
          transcript={[{ who: "Elena", text: "I am sending the lease documents Thursday morning." }, { who: "You", text: "Great. Lena will review them the same day." }, { who: "Elena", text: "Can we move the signing to the 30th?" }]}
        />
      </View>
    );
  }
  if (part === "terminal") {
    return (
      <View style={{ flex: 1, minHeight: 560 }}>
        <Terminal sessionId="ter_1" title="" host="agent" hostLabel="Intake's computer" output={OUTPUT} />
      </View>
    );
  }
  if (part === "locked") {
    return (
      <View style={{ flex: 1, minHeight: 560 }}>
        <Terminal sessionId="ter_2" title="" host="server" hostLabel="Space server" locked owner="Maya Chen" fallbackLabel="Intake's computer" />
      </View>
    );
  }
  return <View style={frame}><Softphone placement="inline" open mode="dialer" numbers={NUMBERS} suggestions={[]} /></View>;
}
