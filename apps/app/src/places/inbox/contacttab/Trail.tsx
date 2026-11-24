import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { clockIn } from "../../../../../../lib/zones.ts";
import { useZones } from "../../../../../../ui/src/Time/index.tsx";

type Trail = CapMap["mail.delivery.trail"]["out"];
type Call = (cap: string, input: Record<string, unknown>) => Promise<unknown> | unknown;

/** The time of day in the Space's time zone, as the rest of the product writes it. */
const clock = (ms: number, zone: string): string => clockIn(ms, zone);

/** The headline under a sent email: only a state a person acts on or cares about. */
export function trailHeadline(t: Trail, zone: string): string {
  const last = [...t.events].reverse();
  const at = (kinds: string[]): Trail["events"][number] | undefined => last.find((e) => kinds.includes(e.kind));
  if (t.state === "bounced") {
    const b = at(["gave_up", "bounced"]);
    return `Bounced${b?.detail ? `: ${b.detail}` : ""}`;
  }
  if (t.state === "complained") return "Marked as spam by the recipient";
  if (t.state === "failed") return "Could not be sent";
  if (t.state === "retrying")
    return t.retry?.nextAt
      ? `Could not be delivered yet. Trying again at ${clock(t.retry.nextAt, zone)} (${t.retry.attempt + 1} of ${t.retry.of})`
      : "Could not be delivered yet. Trying again";
  if (t.state === "delivered") {
    const d = at(["delivered"]);
    return d ? `Delivered ${clock(d.at, zone)}` : "Delivered";
  }
  if (t.state === "waiting") return "Waiting to send";
  return "";
}

/** What happened to a sent email, one quiet line that opens into the whole trail; a bounce says why and which address is now blocked. */
export function DeliveryTrail({ messageId, call }: { messageId: string; call: Call }): ReactElement | null {
  const zone = useZones().space;
  const [trail, setTrail] = useState<Trail | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void Promise.resolve(call("mail.delivery.trail", { messageId })).then(
      (out) => {
        if (alive) setTrail(out as Trail);
      },
      () => undefined, // no trail to show is no line, never an error under a message
    );
    return () => {
      alive = false;
    };
  }, [call, messageId]);
  if (!trail) return null;
  const head = trailHeadline(trail, zone);
  if (!head && trail.events.length <= 1) return null;
  const bad = trail.state === "bounced" || trail.state === "complained" || trail.state === "failed";
  return (
    <View style={st.wrap} testID={`trail:${messageId}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? "Hide delivery details" : "Show delivery details"}
        accessibilityState={{ expanded: open }}
        testID={`trail-toggle:${messageId}`}
        onPress={() => setOpen((o) => !o)}
      >
        <Text style={[st.head, bad && st.bad]}>{head || "Delivery details"}</Text>
      </Pressable>
      {/* ui-rows-lint: not a list (one warning line for each address that is no longer emailed, in the detail text of a message) */}
      {trail.blocked.map((b) => (
        <Text
          key={b.address}
          style={st.bad}
          testID={`trail-blocked:${b.address}`}
        >{`${b.address} will not be emailed again. ${b.reason}`}</Text>
      ))}
      {open
        ? // ui-rows-lint: not a list (the lines of one message's delivery detail, small text under its head)
          trail.events.map((e, i) => (
            <Text
              key={i}
              style={st.line}
            >{`${clock(e.at, zone)}  ${e.label}${e.address ? ` · ${e.address}` : ""}${e.detail ? ` · ${e.detail}` : ""}`}</Text>
          ))
        : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingBottom: 6, gap: 2 },
  head: { fontSize: 12, color: "#6b7280" },
  bad: { color: "#b42318", fontSize: 12 },
  line: { fontSize: 12, color: "#6b7280" },
});
