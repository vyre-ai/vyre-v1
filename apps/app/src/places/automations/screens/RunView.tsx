// A run as one page of rows (design 2.9), from runView(): numbered as the builder is, each with what it did, Values to open, "Not sent" for held steps, and the failure in words with its one button.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppLogo } from "../../../../../../ui/src/AppLogo/index.tsx";
import { glyphOf, tintOf } from "../picker/glyphs.ts";
import type { runView } from "../run/model.ts";
import { look } from "./look.ts";

const mk = (a: { id: string; name: string }) => ({ app: a.id, name: a.name });

export function RunView({ view, onFix }: { view: ReturnType<typeof runView>; onFix(): void }): ReactElement {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string): void =>
    setOpen((o) => (o.has(id) ? new Set([...o].filter((x) => x !== id)) : new Set([...o, id])));
  return (
    <View style={s.page} testID="run-view">
      {view.banner ? (
        <View style={s.banner}>
          <View style={s.grow}>
            <Text style={s.fail}>{view.banner.title}</Text>
            <Text style={look.body}>{view.banner.text}</Text>
          </View>
          <Pressable testID="rv-fix" accessibilityRole="button" onPress={onFix} style={[look.btn, look.primary]}>
            <Text style={look.primaryText}>{view.banner.button}</Text>
          </Pressable>
        </View>
      ) : null}
      {view.when ? (
        <View style={s.row}>
          <Text style={[s.no, s.when]}>When</Text>
          <AppLogo
            app={view.when.app.id}
            name={view.when.app.name}
            size={32}
            glyph={glyphOf(mk(view.when.app))}
            tint={tintOf(mk(view.when.app))}
          />
          <Text style={[look.body, s.grow]}>{view.when.sentence.text}</Text>
        </View>
      ) : null}
      {/* ui-rows-lint: not a list (run rows with a sentence, a result line and openable values) */}
      {view.rows.map((r) => (
        <View key={r.id} style={{ marginLeft: r.depth * 20 }}>
          <View style={[s.row, r.mark === "failed" ? s.rowFailed : null]}>
            <Text
              style={[
                s.no,
                r.mark === "failed" ? s.fail : null,
                r.mark === "done" ? { color: "var(--ok)", fontWeight: "700" } : null,
              ]}
            >
              {r.mark === "done" ? "✓" : r.mark === "skipped" ? "–" : String(r.number)}
            </Text>
            <AppLogo app={r.app.id} name={r.app.name} size={32} glyph={glyphOf(mk(r.app))} tint={tintOf(mk(r.app))} />
            <View style={s.grow}>
              <Text style={look.body}>{r.line ?? r.sentence.text}</Text>
              {r.mark === "failed" || r.tag || (r.line ?? r.sentence.text) !== r.action ? (
                <Text style={look.quiet}>
                  {r.mark === "failed" ? `Failed: ${r.why ?? ""}`.trim() : r.tag ? `${r.action}  ${r.tag}` : r.action}
                </Text>
              ) : null}
            </View>
          </View>
          {r.values.length > 0 ? (
            <>
              <Pressable
                testID={`rv-values-${r.id}`}
                accessibilityRole="button"
                onPress={() => toggle(r.id)}
                style={s.values}
              >
                <Text style={look.quiet}>{`${open.has(r.id) ? "⌄" : "›"}  Values`}</Text>
              </Pressable>
              {open.has(r.id) ? <ValueLines values={r.values} /> : null}
            </>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function ValueLines({ values }: { values: readonly (readonly [string, string])[] }): ReactElement {
  return (
    <View style={s.valueBox}>
      {/* ui-rows-lint: not a list (key and value pairs of one step) */}
      {values.map(([k, v]) => (
        <Text key={k} style={look.quiet}>{`${k}   ${v}`}</Text>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  page: { gap: 8, padding: 16, maxWidth: 690, width: "100%", alignSelf: "center" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "var(--sunk)" as string,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "var(--sunk)" as string,
  },
  rowFailed: {},
  grow: { flex: 1, minWidth: 0, gap: 2 },
  no: { width: 36, textAlign: "center", fontSize: 13, color: "var(--ink-3)" as string },
  when: { fontWeight: "600", color: "var(--accent)" as string },
  fail: { fontSize: 14.5, fontWeight: "600", color: "var(--danger)" as string },
  values: { marginLeft: 48, marginTop: 4, padding: 8, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
  valueBox: { marginLeft: 48, marginTop: 4, padding: 8, gap: 2 },
});
