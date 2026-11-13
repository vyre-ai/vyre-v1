// The builder as one calm page (design 2.5), drawn from story()'s model: the head (name, state in words, Test, one primary), the bars, then When and the numbered sentences. A missing thing is one orange line with
// one button, in place. Nothing here saves or runs: every press goes out through `on`, and the page's owner decides.
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppLogo } from "../../../../../../ui/src/AppLogo/index.tsx";
import type { Sentence, Story } from "../story/model.ts";

export type StoryAction = "bar" | "need" | "open" | "add" | "test" | "primary" | "secondary";

function Btn({
  id,
  label,
  primary,
  disabled,
  onPress,
}: {
  id: string;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onPress(): void;
}): ReactElement {
  return (
    <Pressable
      testID={id}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled === true}
      onPress={onPress}
      style={[s.btn, primary ? s.primary : null, disabled ? s.off : null]}
    >
      <Text style={[s.btnText, primary ? s.primaryText : null]}>{label}</Text>
    </Pressable>
  );
}

function SentenceText({ sentence }: { sentence: Sentence }): ReactElement {
  return (
    <Text style={s.sentence}>
      {sentence.parts.map((p, i) =>
        p.t === "text" ? (
          p.v
        ) : p.t === "blank" ? (
          <Text key={i} style={s.quiet}>
            {"…"}
          </Text>
        ) : (
          <Text key={i} accessibilityHint={p.tip} style={s.chip}>
            {` ${p.label} `}
          </Text>
        ),
      )}
    </Text>
  );
}

export function StoryView({ story, on }: { story: Story; on(action: StoryAction, id?: string): void }): ReactElement {
  const h = story.head;
  return (
    <View style={s.page} testID="story">
      <View style={s.headRow}>
        <View style={s.text}>
          <Text style={s.name}>{h.name}</Text>
          <Text style={s.quiet}>{h.state}</Text>
        </View>
        {h.test ? <Btn id="sv-test" label="Test" onPress={() => on("test")} /> : null}
        {h.secondary ? <Btn id="sv-secondary" label={h.secondary.label} onPress={() => on("secondary")} /> : null}
        {h.primary ? (
          <Btn
            id="sv-primary"
            label={h.primary.label}
            primary
            disabled={h.primary.disabled === true}
            onPress={() => on("primary")}
          />
        ) : null}
      </View>
      {h.primary?.why ? <Text style={s.quiet}>{h.primary.why}</Text> : null}
      {/* ui-rows-lint: not a list (the bars above the steps) */}
      {story.bars.map((b) => (
        <View key={b.kind} style={s.bar}>
          <Text style={[s.text, s.sentence]}>{b.text}</Text>
          {/* ui-rows-lint: not a list (the buttons of one bar) */}
          {b.actions.map((a, i) => (
            <Btn
              key={a}
              id={`sv-bar-${a}`}
              label={a}
              primary={i === b.actions.length - 1}
              onPress={() => on("bar", a)}
            />
          ))}
        </View>
      ))}
      <ScrollView contentContainerStyle={s.rows}>
        {/* ui-rows-lint: not a list (sentence rows with inline data chips; a Row title is plain text) */}
        {story.rows.map((r) =>
          r.kind === "label" || r.kind === "head" ? (
            <Text
              key={`l-${r.kind === "head" ? r.text : r.label}-${r.depth}`}
              style={[s.quiet, { marginLeft: r.depth * 16 }]}
            >
              {r.kind === "head" ? r.text : r.label}
            </Text>
          ) : (
            <Pressable
              key={r.id}
              testID={`sv-step-${r.id}`}
              accessibilityRole="button"
              onPress={() => on("open", r.id)}
              style={[
                s.row,
                r.kind === "step" ? { marginLeft: r.depth * 16 } : null,
                r.kind === "step" && r.proposed ? s.proposed : null,
              ]}
            >
              <Text style={s.no}>{r.kind === "trigger" ? "When" : String(r.number)}</Text>
              <AppLogo app={r.app.id} name={r.app.name} size={32} />
              <View style={s.text}>
                <SentenceText sentence={r.sentence} />
                {r.kind === "step" && r.need ? (
                  <View style={s.needRow}>
                    <Text style={s.warn}>{r.need.line}</Text>
                    <Btn id={`sv-need-${r.id}`} label={r.need.button} onPress={() => on("need", r.id)} />
                  </View>
                ) : r.kind === "step" ? (
                  <Text style={s.quiet}>{r.action}</Text>
                ) : null}
              </View>
            </Pressable>
          ),
        )}
        <Btn id="sv-add" label="Add a step" onPress={() => on("add")} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { gap: 10, padding: 16, maxWidth: 760, width: "100%", alignSelf: "center" },
  headRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 17, fontWeight: "600", color: "var(--ink)" as string },
  text: { flex: 1, minWidth: 0 },
  quiet: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  sentence: { fontSize: 13, lineHeight: 20, color: "var(--ink)" as string },
  chip: { fontSize: 12, color: "var(--ink-2)" as string, backgroundColor: "var(--sunk)" as string },
  warn: { flex: 1, fontSize: 12.5, color: "var(--warn)" as string },
  needRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "var(--sunk)" as string,
  },
  rows: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 12 },
  proposed: { borderWidth: 1, borderStyle: "dashed", borderColor: "var(--line)" as string },
  no: { width: 36, fontSize: 12, color: "var(--ink-3)" as string, textAlign: "center" },
  btn: {
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--hover)" as string,
  },
  btnText: { fontSize: 12.5, color: "var(--ink)" as string },
  primary: { backgroundColor: "var(--accent)" as string },
  primaryText: { color: "var(--accent-ink)" as string },
  off: { opacity: 0.45 },
});
