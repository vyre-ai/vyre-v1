// The builder as one calm page (design 2.5), drawn from story()'s model: the head (name, state in words, Test, one primary), the bars, then When and the numbered sentences. A missing thing is one orange line with
// one button, in place. Nothing here saves or runs: every press goes out through `on`, and the page's owner decides.
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppLogo } from "../../../../../../ui/src/AppLogo/index.tsx";
import { glyphOf, tintOf } from "../picker/glyphs.ts";
import type { Sentence, Story } from "../story/model.ts";
import { look } from "./look.ts";

export type StoryAction = "bar" | "need" | "open" | "add" | "test" | "primary" | "secondary" | "ask" | "insert";

function Btn({
  id,
  label,
  kind,
  disabled,
  onPress,
}: {
  id: string;
  label: string;
  kind: "primary" | "quiet" | "outlined";
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
      style={[
        look.btn,
        kind === "primary" ? look.primary : kind === "outlined" ? look.outlined : null,
        disabled ? s.off : null,
      ]}
    >
      <Text style={kind === "primary" ? look.primaryText : look.btnText}>{label}</Text>
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
          <Text key={i} style={look.quiet}>
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
        <View style={s.grow}>
          <Text style={s.name}>{h.name}</Text>
          <Text style={look.quiet}>{h.state}</Text>
        </View>
        <Btn id="sv-ask" label="Ask Vyre" kind="outlined" onPress={() => on("ask")} />
        {h.test ? <Btn id="sv-test" label="Test" kind="quiet" onPress={() => on("test")} /> : null}
        {h.secondary ? (
          <Btn id="sv-secondary" label={h.secondary.label} kind="quiet" onPress={() => on("secondary")} />
        ) : null}
        {h.primary ? (
          <Btn
            id="sv-primary"
            label={h.primary.label}
            kind="primary"
            disabled={h.primary.disabled === true}
            onPress={() => on("primary")}
          />
        ) : null}
      </View>
      {h.primary?.why ? <Text style={look.quiet}>{h.primary.why}</Text> : null}
      {/* ui-rows-lint: not a list (the bars above the steps) */}
      {story.bars.map((b) => (
        <View key={b.kind} style={s.bar}>
          <Text style={[s.grow, s.barText]}>{b.text}</Text>
          {/* ui-rows-lint: not a list (the buttons of one bar) */}
          {b.actions.map((a, i) => (
            <Btn
              key={a}
              id={`sv-bar-${a}`}
              label={a}
              kind={i === b.actions.length - 1 ? "primary" : "quiet"}
              onPress={() => on("bar", a)}
            />
          ))}
        </View>
      ))}
      <ScrollView contentContainerStyle={s.rows}>
        {/* ui-rows-lint: not a list (sentence rows with inline data chips; a Row title is plain text) */}
        {story.rows.map((r) => {
          if (r.kind === "label" || r.kind === "head")
            return (
              <Text
                key={`l-${r.kind === "head" ? r.text : r.label}-${r.depth}`}
                style={[look.quiet, { marginLeft: 8 + r.depth * 20 }]}
              >
                {r.kind === "head" ? r.text : r.label}
              </Text>
            );
          const split = r.kind === "trigger" ? splitHead(r.sentence) : null;
          return (
            <View key={r.id}>
              <Pressable
                testID={`sv-step-${r.id}`}
                accessibilityRole="button"
                onPress={() => on("open", r.id)}
                style={[
                  s.row,
                  r.kind === "step" ? { marginLeft: r.depth * 20 } : null,
                  r.kind === "step" && r.proposed ? s.proposed : null,
                ]}
              >
                <Text style={[s.no, r.kind === "trigger" ? s.when : null]}>
                  {r.kind === "trigger" ? "When" : String(r.number)}
                </Text>
                <AppLogo
                  app={r.app.id}
                  name={r.app.name}
                  size={32}
                  glyph={glyphOf({ app: r.app.id, name: r.app.name })}
                  tint={tintOf({ app: r.app.id, name: r.app.name })}
                />
                <View style={s.grow}>
                  {split ? (
                    <>
                      <Text style={s.sentence}>{split.head}</Text>
                      {split.rest ? <Text style={look.quiet}>{split.rest}</Text> : null}
                    </>
                  ) : (
                    <SentenceText sentence={r.sentence} />
                  )}
                  {r.kind === "step" && r.need ? (
                    <View style={s.needRow}>
                      <Text style={[look.warn, { flexShrink: 1 }]}>{r.need.line}</Text>
                      <Btn
                        id={`sv-need-${r.id}`}
                        label={r.need.button}
                        kind="outlined"
                        onPress={() => on("need", r.id)}
                      />
                    </View>
                  ) : r.kind === "step" ? (
                    <Text style={look.quiet}>{r.proposed ? `${r.action} · proposed` : r.action}</Text>
                  ) : null}
                </View>
              </Pressable>
              {story.slots.includes(r.id) ? (
                <Pressable
                  testID={`sv-slot-${r.id}`}
                  accessibilityRole="button"
                  accessibilityLabel="Add a step here"
                  onPress={() => on("insert", r.id)}
                  style={s.slot}
                >
                  <Text style={s.addPlus}>+</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
        <Pressable testID="sv-add" accessibilityRole="button" onPress={() => on("add")} style={s.add}>
          <Text style={s.addPlus}>+</Text>
          <Text style={look.quiet}>Add a step</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/** "A form is submitted: Intake questionnaire" reads as the head, then the detail quiet under it. */
function splitHead(sentence: Sentence): { head: string; rest: string } {
  const at = sentence.text.indexOf(": ");
  return at < 0
    ? { head: sentence.text, rest: "" }
    : { head: sentence.text.slice(0, at), rest: sentence.text.slice(at + 2) };
}

const s = StyleSheet.create({
  page: { gap: 12, padding: 16, maxWidth: 760, width: "100%", alignSelf: "center" },
  headRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 17, fontWeight: "600", color: "var(--ink)" as string },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  sentence: { fontSize: 15, lineHeight: 22, color: "var(--ink)" as string },
  barText: { fontSize: 14, color: "var(--ink)" as string },
  chip: {
    fontSize: 13.5,
    fontWeight: "500",
    color: "var(--accent)" as string,
    backgroundColor: "var(--accent-wash)" as string,
  },
  needRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "var(--accent-wash)" as string,
    borderWidth: 1,
    borderColor: "var(--accent-line)" as string,
  },
  rows: { gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
    backgroundColor: "var(--raised)" as string,
  },
  proposed: { borderStyle: "dashed", borderColor: "var(--accent-line)" as string },
  no: { width: 36, fontSize: 13, color: "var(--ink-3)" as string, textAlign: "center" },
  when: { fontWeight: "600", color: "var(--accent)" as string },
  slot: { height: 22, alignItems: "flex-start", justifyContent: "center" },
  add: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 12 },
  addPlus: { width: 36, textAlign: "center", fontSize: 18, color: "var(--ink-3)" as string },
  off: { opacity: 0.45 },
});
