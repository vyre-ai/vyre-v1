// The strip of a Vyre document page: Editing or Suggesting, the Field button, and the review of suggestions (how many, previous, next, Accept all, Reject all); and the card on one suggestion.
// Little text: a count, two arrows and two words. Every press is defined: Field types "{" so the picker opens where the caret is; the arrows move the caret to the next suggestion; the card's buttons resolve that one.
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useWhenText } from "../../Time/index.tsx";
import type { Change } from "./track.ts";

type Hover = { hovered?: boolean };
const web = Platform.OS === "web";
const webProps = (props: Record<string, unknown>): Record<string, unknown> => (web ? props : {});
const noFocusSteal = webProps({ onMouseDown: (e: { preventDefault(): void }) => e.preventDefault() });

export interface DocBarProps {
  /** Show the Editing / Suggesting switch (the person may edit and has a name to sign suggestions with). */
  canSuggest: boolean;
  suggesting: boolean;
  onSuggesting: (on: boolean) => void;
  /** Show the Field button (the page knows the fields of its record type). */
  hasFields: boolean;
  onField: () => void;
  /** How many suggestions wait, and the five ways to deal with them. */
  count: number;
  onPrev: () => void;
  onNext: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  /** Who may accept or reject: someone who can edit. */
  canResolve: boolean;
}

export function DocBar(p: DocBarProps): ReactElement | null {
  if (!p.canSuggest && !p.hasFields && p.count === 0) return null;
  return (
    <View style={s.bar} testID="doc-bar" accessibilityRole="toolbar" accessibilityLabel="Document" {...noFocusSteal}>
      <View style={s.group}>
        {p.canSuggest ? (
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Editing or Suggesting"
            style={s.seg}
            testID="doc-mode"
          >
            {/* ui-rows-lint: not a list (a two-way segmented switch: Editing or Suggesting) */}
            {([false, true] as const).map((on) => (
              <Pressable
                key={String(on)}
                accessibilityRole="radio"
                accessibilityLabel={on ? "Suggesting" : "Editing"}
                accessibilityState={{ checked: p.suggesting === on }}
                onPress={() => p.onSuggesting(on)}
                testID={on ? "doc-mode-suggesting" : "doc-mode-editing"}
                style={({ hovered }: Hover) => [
                  s.segBtn,
                  p.suggesting === on && s.segOn,
                  hovered === true && p.suggesting !== on && s.hover,
                ]}
              >
                <Text style={[s.segText, p.suggesting === on && s.segTextOn]}>{on ? "Suggesting" : "Editing"}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {p.hasFields ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Insert a field"
            testID="doc-field"
            onPress={p.onField}
            style={({ hovered }: Hover) => [s.btn, hovered === true && s.hover]}
            {...webProps({ dataSet: { tt: "Insert a field" } })}
          >
            <Text style={s.btnText}>{"{ } Field"}</Text>
          </Pressable>
        ) : null}
      </View>
      {p.count > 0 ? (
        <View style={s.group} testID="doc-review">
          <Text style={s.count} testID="doc-count" accessibilityLiveRegion="polite">
            {p.count === 1 ? "1 suggestion" : `${p.count} suggestions`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous suggestion"
            testID="doc-prev"
            onPress={p.onPrev}
            style={({ hovered }: Hover) => [s.arrow, hovered === true && s.hover]}
          >
            <Text style={s.btnText}>{"‹"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next suggestion"
            testID="doc-next"
            onPress={p.onNext}
            style={({ hovered }: Hover) => [s.arrow, hovered === true && s.hover]}
          >
            <Text style={s.btnText}>{"›"}</Text>
          </Pressable>
          {p.canResolve ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reject all suggestions"
                testID="doc-reject-all"
                onPress={p.onRejectAll}
                style={({ hovered }: Hover) => [s.btn, hovered === true && s.hover]}
              >
                <Text style={s.btnText}>Reject all</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Accept all suggestions"
                testID="doc-accept-all"
                onPress={p.onAcceptAll}
                style={({ hovered }: Hover) => [s.btn, s.primary, hovered === true && s.primaryHover]}
              >
                <Text style={[s.btnText, s.primaryText]}>Accept all</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const short = (t: string): string => {
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > 60 ? `${one.slice(0, 57)}...` : one;
};

/** The card on one suggestion: who, when, what changed, and the two ways to settle it. */
export function ChangeCard(p: {
  change: Change;
  left: number;
  top: number;
  canResolve: boolean;
  onAccept: () => void;
  onReject: () => void;
}): ReactElement {
  const c = p.change;
  const whenOf = useWhenText();
  const at = Date.parse(c.at);
  const when = Number.isNaN(at) ? "" : whenOf(at, Date.now());
  return (
    <View
      style={[s.card, { left: p.left, top: p.top }]}
      testID="doc-change-card"
      accessibilityRole="menu"
      accessibilityLabel="Suggestion"
      {...noFocusSteal}
    >
      <Text style={s.cardHead} testID="doc-change-who">
        {c.author === "" ? "Suggestion" : c.author}
        {when === "" ? "" : `  ${when}`}
      </Text>
      <Text style={s.cardBody} testID="doc-change-text">
        {c.kind === "add"
          ? `Add “${short(c.added)}”`
          : c.kind === "del"
            ? `Remove “${short(c.old)}”`
            : `“${short(c.old)}” to “${short(c.added)}”`}
      </Text>
      {p.canResolve ? (
        <View style={s.cardRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reject this suggestion"
            testID="doc-change-reject"
            onPress={p.onReject}
            style={({ hovered }: Hover) => [s.btn, hovered === true && s.hover]}
          >
            <Text style={s.btnText}>Reject</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Accept this suggestion"
            testID="doc-change-accept"
            onPress={p.onAccept}
            style={({ hovered }: Hover) => [s.btn, s.primary, hovered === true && s.primaryHover]}
          >
            <Text style={[s.btnText, s.primaryText]}>Accept</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: "var(--line)" as string,
    backgroundColor: "var(--win)" as string,
  },
  group: { flexDirection: "row", alignItems: "center", gap: 6 },
  seg: { flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  segBtn: { height: 24, paddingHorizontal: 10, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: "var(--raised)" as string },
  segText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  segTextOn: { color: "var(--ink)" as string, fontWeight: "600" },
  hover: { backgroundColor: "var(--hover)" as string },
  btn: { height: 26, paddingHorizontal: 10, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  arrow: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 13, color: "var(--ink-2)" as string },
  count: { fontSize: 12.5, color: "var(--ink-3)" as string, marginRight: 2 },
  primary: { backgroundColor: "var(--accent)" as string },
  primaryHover: { backgroundColor: "var(--accent)" as string, opacity: 0.88 },
  primaryText: { color: "var(--on-accent, #fff)" as string, fontWeight: "600" },
  card: {
    position: "absolute",
    zIndex: 25,
    minWidth: 220,
    maxWidth: 320,
    padding: 10,
    gap: 6,
    borderRadius: 10,
    backgroundColor: "var(--raised)" as string,
    borderWidth: 1,
    borderColor: "var(--line-2)" as string,
  },
  cardHead: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  cardBody: { fontSize: 13, color: "var(--ink)" as string },
  cardRow: { flexDirection: "row", justifyContent: "flex-end", gap: 6 },
});
