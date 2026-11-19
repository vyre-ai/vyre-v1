// Helpers side by side while they work (lane r42-subagents, prototype sub42, 19 Nov 2026): one tile each, three across, a face in a ring, what it was asked, a three-line live window, tokens and cost, a clock.
// The same piece of work as a row (CrewBlock) in another shape; both read a RunView, so they never disagree. A tile that needs you turns amber; one that could not finish says why and offers Retry for that one.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { MemberRing, timeOf } from "../crew/strip.tsx";
import { Glyph } from "../conversation/parts.tsx";
import type { GlyphName } from "../conversation/parts.tsx";
import { money, tokens, faceSeed } from "../crew/model.ts";
import type { RunView } from "../crew/run-view.ts";

const web = Platform.OS === "web";
/** The mark before a live line, from the kind of step the runtime reports (a mark that has no glyph here is left out). */
const STEP_GLYPH: Record<string, GlyphName> = {
  read: "file",
  web: "cloud",
  term: "term",
  edit: "edit",
  find: "search",
  think: "spark",
  send: "up",
  kid: "fork",
};

export function HelperTile({
  r,
  now,
  selected,
  index,
  onPress,
  onRetry,
  onDecide,
  may,
  decided,
}: {
  r: RunView;
  now: number;
  selected: boolean;
  index: number;
  onPress: (id: string) => void;
  onRetry?: ((id: string) => void) | undefined;
  /** Answer the held request: Allow or Deny, inside the tile. */
  onDecide?: ((task: string, verdict: "approve" | "reject", note?: string) => void) | undefined;
  /** What this person may answer on the held request (the same read as the card): Allow, Deny. */
  may?: { approve: boolean; reject: boolean } | undefined;
  /** What was pressed for this tile, so it says so and cannot be answered twice. */
  /** What was answered for THIS request (keyed by the request in the grid: a later request of the same helper starts clean). */
  decided?: "approve" | "reject" | "failed" | undefined;
}): ReactElement {
  const id = `crew-tile-${r.id}`;
  // Deny needs a reason, as it does on the card: pressed once it asks for it
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  // a new request of the same helper starts clean: no half-typed reason from the last one
  useEffect(() => {
    setAsking(false);
    setReason("");
  }, [r.holdTaskId]);
  const live = r.state === "working";
  const canRetry = (r.state === "failed" || r.state === "stopped") && onRetry !== undefined;
  // a helper that waits for another has not started: no clock, no tokens
  const waiting = r.dependsLine !== undefined;
  const meter = waiting
    ? ""
    : [r.tokens > 0 ? `${tokens(r.tokens)} tokens` : "", r.costMicros > 0 ? money(r.costMicros) : ""]
        .filter((x) => x !== "")
        .join(" · ");
  const lines = r.lines.length > 0 ? r.lines : r.dependsLine !== undefined ? [] : [live ? "Starting" : ""];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${r.name}, ${lines[lines.length - 1] ?? ""}`}
      testID={id}
      onPress={() => onPress(r.id)}
      {...(web ? { dataSet: { state: r.state, kind: r.kind } } : {})}
      style={[
        st.tile,
        r.state === "needs_you" && !selected && st.need,
        r.state === "needs_you" && selected && st.needSel,
        r.state !== "needs_you" && selected && st.sel,
        web ? ({ animationDelay: `${index * 60}ms` } as object) : null,
      ]}
    >
      <View style={st.head}>
        <View style={st.av}>
          <MemberRing state={r.state} id={id} size={32} />
          <Avatar name={r.name} seedId={faceSeed(r)} kind="agent" size={24} />
        </View>
        <View style={st.who}>
          <Text numberOfLines={1} style={st.name}>
            {r.name}
          </Text>
          {r.task !== "" ? (
            <Text numberOfLines={1} testID={`${id}-task`} style={st.task}>
              {r.task}
            </Text>
          ) : null}
        </View>
        <Text testID={`${id}-time`} style={st.time}>
          {waiting ? "waiting" : timeOf(r, now)}
        </Text>
      </View>
      <View testID={`${id}-window`} style={st.win}>
        {r.stepIcon !== undefined && STEP_GLYPH[r.stepIcon] !== undefined ? (
          <View testID={`${id}-step-icon`} accessibilityLabel={r.stepIcon} style={st.stepIcon}>
            <Glyph name={STEP_GLYPH[r.stepIcon]!} size={12} color="var(--ink-3)" />
          </View>
        ) : null}
        {/* ui-rows-lint: not a list (the three live lines of one tile: plain text, no row to press) */}
        {lines.map((x, i) => (
          <Text
            key={`${i}-${x}`}
            numberOfLines={r.state === "working" ? 1 : 3}
            testID={`${id}-line-${i}`}
            style={[
              st.line,
              live && i < lines.length - 1 && st.dim,
              r.state === "needs_you" && st.lineNeed,
              r.state === "failed" && st.lineFail,
            ]}
          >
            {x}
          </Text>
        ))}
        {r.stuck !== undefined ? (
          <View testID={`${id}-stuck`} style={st.sleepRow}>
            <Glyph name="alert" size={12} color="var(--warn)" />
            <Text numberOfLines={1} style={st.quiet}>
              Stuck · {r.stuck}
            </Text>
          </View>
        ) : null}
        {r.sleep !== undefined ? (
          <View testID={`${id}-sleep`} style={st.sleepRow}>
            <Glyph name="moon" size={12} color="var(--ink-3)" />
            <Text numberOfLines={1} style={st.line}>
              {r.sleep}
            </Text>
          </View>
        ) : null}
        {r.dependsLine !== undefined ? (
          <View testID={`${id}-depends`} style={st.sleepRow}>
            <Glyph name="chev" size={12} color="var(--accent)" />
            <Text numberOfLines={1} style={st.dep}>
              {r.dependsLine}
            </Text>
          </View>
        ) : null}
        {r.state === "needs_you" &&
        r.holdTaskId !== undefined &&
        onDecide !== undefined &&
        (decided === "approve" || decided === "reject" || may?.approve || may?.reject) ? (
          decided === "approve" || decided === "reject" ? (
            <Text testID={`${id}-decided`} style={st.line}>
              {decided === "approve" ? "Allowed" : "Denied"}
            </Text>
          ) : (
            <View style={st.decide}>
              {decided === "failed" ? (
                <Text testID={`${id}-decide-failed`} style={st.line}>
                  Could not answer. Try again.
                </Text>
              ) : null}
              {asking ? (
                <View style={st.decideRow}>
                  <TextInput
                    testID={`${id}-deny-reason`}
                    value={reason}
                    onChangeText={setReason}
                    placeholder="Why not?"
                    placeholderTextColor="var(--ink-4)"
                    style={st.reason}
                  />
                  <Pressable
                    accessibilityRole="button"
                    testID={`${id}-deny-go`}
                    onPress={() => reason.trim() !== "" && onDecide(r.holdTaskId!, "reject", reason.trim())}
                    style={st.retry}
                  >
                    <Text style={st.retryText}>Deny</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={st.decideRow}>
                  {may?.approve ? (
                    <Pressable
                      accessibilityRole="button"
                      testID={`${id}-allow`}
                      onPress={() => onDecide(r.holdTaskId!, "approve")}
                      style={st.allow}
                    >
                      <Text style={st.allowText}>Allow</Text>
                    </Pressable>
                  ) : null}
                  {may?.reject ? (
                    <Pressable
                      accessibilityRole="button"
                      testID={`${id}-deny`}
                      onPress={() => setAsking(true)}
                      style={st.retry}
                    >
                      <Text style={st.retryText}>Deny</Text>
                    </Pressable>
                  ) : null}
                </View>
              )}
            </View>
          )
        ) : null}
        {canRetry ? (
          <Pressable accessibilityRole="button" testID={`${id}-retry`} onPress={() => onRetry!(r.id)} style={st.retry}>
            <Text style={st.retryText}>{r.state === "stopped" ? "Start again" : "Retry"}</Text>
          </Pressable>
        ) : null}
      </View>
      {!waiting && (meter !== "" || r.model !== "") ? (
        <Text numberOfLines={1} testID={`${id}-meter`} style={st.meter}>
          {[meter, r.model].filter((x) => x !== "").join(" · ")}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** The grid: three across, fewer when there are fewer. A plain flex wrap off the web. */
export function CrewTiles({
  runs,
  now,
  selectedId,
  onPress,
  onRetry,
  onDecide,
  may,
  decided,
}: {
  runs: readonly RunView[];
  now: number;
  selectedId?: string | null | undefined;
  onPress: (id: string) => void;
  onRetry?: ((id: string) => void) | undefined;
  onDecide?: ((task: string, verdict: "approve" | "reject", note?: string) => void) | undefined;
  may?: Readonly<Record<string, { approve: boolean; reject: boolean }>> | undefined;
  decided?: Readonly<Record<string, "approve" | "reject" | "failed">> | undefined;
}): ReactElement {
  const cols = Math.min(3, Math.max(1, runs.length));
  return (
    <View
      testID="crew-tiles"
      style={[
        st.grid,
        web ? ({ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } as object) : null,
      ]}
    >
      {/* ui-rows-lint: not a list (the tiles of one crew block, drawn side by side as the prototype sub42 shows them) */}
      {runs.map((r, i) => (
        <HelperTile
          key={r.id}
          r={r}
          now={now}
          index={i}
          selected={selectedId === r.id}
          onPress={onPress}
          onRetry={onRetry}
          onDecide={onDecide}
          may={may?.[r.id]}
          decided={r.holdTaskId !== undefined ? decided?.[r.holdTaskId] : undefined}
        />
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  grid: {
    gap: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 4,
    borderRadius: 14,
    backgroundColor: "var(--sunk)" as string,
  },
  tile: {
    flexGrow: 1,
    minWidth: 0,
    gap: 7,
    padding: 10,
    paddingBottom: 9,
    borderRadius: 12,
    backgroundColor: "var(--raised)" as string,
  },
  // the warn colour of the skin at low alpha, laid over the tile (a colour mix is dropped as a background by the web layer, an inset shadow is not): the same in every skin and both modes
  need: { boxShadow: "inset 0 0 0 600px color-mix(in srgb, var(--warn) 13%, transparent)" } as object,
  needSel: {
    boxShadow: "inset 0 0 0 600px color-mix(in srgb, var(--warn) 13%, transparent), inset 0 0 0 1.5px var(--accent)",
  } as object,
  sel: { boxShadow: "inset 0 0 0 1.5px var(--accent)" } as object,
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  av: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  who: { flex: 1, minWidth: 0 },
  name: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  task: { fontSize: 12, color: "var(--ink-3)" as string },
  time: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  win: { gap: 2, minHeight: 36 },
  line: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  dim: { color: "var(--ink-4)" as string },
  lineNeed: { color: "var(--ink)" as string },
  lineFail: { color: "var(--ink)" as string },
  quiet: { fontSize: 12, color: "var(--ink-3)" as string },
  sleepRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  dep: { fontSize: 11.5, color: "var(--accent)" as string },
  stepIcon: { position: "absolute", right: 0, top: 3 },
  decide: { gap: 4 },
  decideRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  reason: {
    flex: 1,
    minWidth: 0,
    height: 26,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "var(--field)" as string,
    color: "var(--ink)" as string,
    fontSize: 12.5,
  },
  allow: {
    height: 26,
    paddingHorizontal: 12,
    borderRadius: 9,
    justifyContent: "center",
    backgroundColor: "var(--accent)" as string,
  },
  allowText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent-ink)" as string },
  retry: {
    alignSelf: "flex-start",
    marginTop: 6,
    height: 26,
    paddingHorizontal: 11,
    borderRadius: 9,
    justifyContent: "center",
    backgroundColor: "var(--sel)" as string,
  },
  retryText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
  meter: { fontSize: 11.5, color: "var(--ink-4)" as string, fontVariant: ["tabular-nums"] },
});
