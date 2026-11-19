// Mount for DEPS_01 (lane r42-subagents, 19 Nov 2026): the crew block as the booted daemon served it at three moments (captured by test/helper-ui.walk.live.test.ts with HELPER_CAPTURE): a helper waiting for another,
// the moment a helper stood queued behind one that failed, and after the host failed it. The real CrewBlock over the real members and nodes; only the model was scripted.
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { CrewBlock } from "../../../apps/app/src/places/chats/session/CrewBlock.tsx";
import { totalsOf } from "../../../apps/app/src/places/chats/crew/model.ts";
import type { CrewMember } from "../../../apps/app/src/places/chats/crew/model.ts";
import { nameStandIns } from "../../../apps/app/src/places/chats/crew/run/model.ts";
import { nodesOf } from "../../../apps/app/src/places/chats/crew/run/reads.ts";
import CAPTURE from "./helper-daemon.json";

export const title = "A helper that waits, as the daemon served it";

type Snap = { members: CrewMember[]; nodes: unknown[] };
const SNAPS = CAPTURE as unknown as Record<string, Snap>;
const STATES: Array<[string, string]> = [
  ["waiting", "Waiting for another helper"],
  ["cant-start", "Behind one that failed"],
  ["failed", "Failed with it"],
];

/** The capture was taken some time ago: move every timestamp in it so the moment it was taken reads as a few seconds ago, as it did live (the clocks count from the node's own start). */
function shifted(s: Snap): Snap {
  const stamps = (o: Record<string, unknown>): number[] =>
    ["startedAt", "endedAt"].flatMap((f) => (typeof o[f] === "number" ? [o[f] as number] : []));
  const all = [...s.members, ...(s.nodes as Array<Record<string, unknown>>)].flatMap((o) => stamps(o as never));
  const by = Date.now() - 4_000 - Math.max(...all);
  const move = <T extends Record<string, unknown>>(o: T): T => {
    const c: Record<string, unknown> = { ...o };
    for (const f of ["startedAt", "endedAt"]) if (typeof c[f] === "number") c[f] = (c[f] as number) + by;
    return c as T;
  };
  return {
    members: s.members.map((m) => move(m as never)) as CrewMember[],
    nodes: s.nodes.map((n) => move(n as never)),
  };
}

export default function Mount(): ReactNode {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <View testID="deps-mount" style={{ padding: 20, maxWidth: 700, gap: 22 }}>
        {STATES.filter(([k]) => SNAPS[k] !== undefined).map(([k, label]) => {
          const s = shifted(SNAPS[k]!);
          const titles = new Map(s.members.map((m) => [m.id, (m.name ?? m.title).trim()] as const));
          const nodes = nameStandIns(nodesOf({ nodes: s.nodes }), titles);
          return (
            <View key={k} testID={`deps-${k}`} style={{ gap: 6 }}>
              <Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>{label}</Text>
              <CrewBlock
                members={s.members}
                totals={totalsOf(s.members)}
                view="auto"
                call={async () => ({})}
                nodes={nodes}
                meId="usr_me"
                onPeek={() => undefined}
                onOpenPane={() => undefined}
                onStopAll={() => undefined}
                onRetry={() => undefined}
              />
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
