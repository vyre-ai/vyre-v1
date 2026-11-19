// The suggestions beside a document: a count, Accept all, and one row per change with who and when, what was removed and added, and a reject and an accept button. Pressing a row takes the caret to it.
// It reads a DocController the page fills; nothing here knows about the editor.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useWhenText } from "../../Time/index.tsx";
import type { DocController } from "./controller.ts";
import type { Change } from "./track.ts";

type Hover = { hovered?: boolean };

export function useDocChanges(c: DocController): Change[] {
  const [list, setList] = useState<Change[]>(c.changes);
  useEffect(() => {
    setList(c.changes);
    return c.subscribe(() => setList(c.changes));
  }, [c]);
  return list;
}

const initials = (a: string): string =>
  a
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("") || "?";

export function SuggestionsPane({
  controller,
  canResolve = true,
}: {
  controller: DocController;
  canResolve?: boolean;
}): ReactElement {
  const list = useDocChanges(controller);
  const when = useWhenText();
  return (
    <View style={s.pane} testID="doc-suggestions">
      <View style={s.head}>
        <Text style={s.title} accessibilityLiveRegion="polite" testID="doc-suggestions-count">
          {list.length === 0 ? "Suggestions" : list.length === 1 ? "1 suggestion" : `${list.length} suggestions`}
        </Text>
        {list.length > 0 && canResolve ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Accept all suggestions"
            testID="doc-suggestions-accept-all"
            onPress={() => controller.actions?.acceptAll()}
            style={({ hovered }: Hover) => [s.all, hovered === true && s.hover]}
          >
            <Text style={s.allText}>Accept all</Text>
          </Pressable>
        ) : null}
      </View>
      {list.length === 0 ? (
        <Text style={s.empty} testID="doc-suggestions-empty">
          Nothing waiting. New suggestions show here as they are written.
        </Text>
      ) : (
        <View>
          {/* ui-rows-lint: not a list (each change is a card with its own two buttons) */}
          {list.map((c) => {
            const at = Date.parse(c.at);
            return (
              <Pressable
                key={`${c.from}:${c.kind}`}
                accessibilityRole="button"
                accessibilityLabel={`Go to the suggestion by ${c.author || "someone"}`}
                testID="doc-suggestion"
                onPress={() => controller.actions?.goTo(c)}
                style={({ hovered }: Hover) => [s.card, hovered === true && s.hover]}
              >
                <Text style={s.text} numberOfLines={3}>
                  {c.old !== "" ? <Text style={s.del}>{c.old.trim()} </Text> : null}
                  {c.added !== "" ? <Text style={s.add}>{c.added.trim()}</Text> : null}
                </Text>
                <View style={s.meta}>
                  <View style={s.av}>
                    <Text style={s.avText}>{initials(c.author)}</Text>
                  </View>
                  <Text style={s.who} numberOfLines={1}>
                    {c.author === "" ? "Suggestion" : c.author}
                    {Number.isNaN(at) ? "" : `  ${when(at, Date.now())}`}
                  </Text>
                  <View style={s.grow} />
                  {canResolve ? (
                    <>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Reject"
                        testID="doc-suggestion-reject"
                        onPress={() => controller.actions?.reject(c)}
                        style={({ hovered }: Hover) => [s.icon, hovered === true && s.hover]}
                      >
                        <Text style={s.iconText}>{"✕"}</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Accept"
                        testID="doc-suggestion-accept"
                        onPress={() => controller.actions?.accept(c)}
                        style={({ hovered }: Hover) => [s.icon, hovered === true && s.hover]}
                      >
                        <Text style={[s.iconText, s.yes]}>{"✓"}</Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  pane: { flex: 1, minWidth: 0 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    height: 44,
    borderBottomWidth: 1,
    borderBottomColor: "var(--line)" as string,
  },
  title: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  all: { height: 26, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center" },
  allText: { fontSize: 13, color: "var(--accent)" as string },
  hover: { backgroundColor: "var(--hover)" as string },
  empty: { fontSize: 13, color: "var(--ink-3)" as string, padding: 16, lineHeight: 19 },
  card: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "var(--line)" as string,
  },
  text: { fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string },
  del: { textDecorationLine: "line-through", color: "var(--ink-3)" as string },
  add: { textDecorationLine: "underline", color: "var(--ink)" as string },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  av: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "var(--accent-wash)" as string,
    alignItems: "center",
    justifyContent: "center",
  },
  avText: { fontSize: 9.5, fontWeight: "600", color: "var(--accent)" as string },
  who: { fontSize: 12, color: "var(--ink-3)" as string, flexShrink: 1 },
  grow: { flex: 1 },
  icon: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  iconText: { fontSize: 13, color: "var(--ink-3)" as string },
  yes: { color: "var(--accent)" as string },
});
