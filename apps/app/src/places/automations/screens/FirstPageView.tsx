// The first page of Automations (design 2.3), drawn from firstPage()'s model: Needs you cards with their fix, at most one suggestion, one Today line, then the ways in. No line explains the page.
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppLogo } from "../../../../../../ui/src/AppLogo/index.tsx";
import type { FirstPage } from "../first/model.ts";

export interface FirstPageViewProps {
  page: FirstPage;
  onFix(needId: string): void;
  onSeeRun(runId: string): void;
  onSetUp(suggestionId: string): void;
  onNotNow(suggestionId: string): void;
  onNew(): void;
  onExamples(): void;
  onAllRuns(): void;
}

function Btn({
  id,
  label,
  primary,
  onPress,
}: {
  id: string;
  label: string;
  primary?: boolean;
  onPress(): void;
}): ReactElement {
  return (
    <Pressable testID={id} accessibilityRole="button" onPress={onPress} style={[s.btn, primary ? s.primary : null]}>
      <Text style={[s.btnText, primary ? s.primaryText : null]}>{label}</Text>
    </Pressable>
  );
}

export function FirstPageView(p: FirstPageViewProps): ReactElement {
  const { needs, suggestion, today } = p.page;
  return (
    <ScrollView testID="first-page" contentContainerStyle={s.col}>
      {needs.length > 0 ? <Text style={s.head}>Needs you</Text> : null}
      {/* ui-rows-lint: not a list (Needs you cards, each with its own fix) */}
      {needs.map((n) => (
        <View key={n.id} style={s.card}>
          <AppLogo app={n.app ?? "vyre:logic"} name={n.automation} size={32} />
          <View style={s.text}>
            <Text style={s.title}>{n.automation}</Text>
            <Text style={s.quiet}>{n.why}</Text>
          </View>
          {n.runId ? <Btn id={`fp-run-${n.id}`} label="See the run" onPress={() => p.onSeeRun(n.runId!)} /> : null}
          <Btn id={`fp-fix-${n.id}`} label={n.fix.label} primary onPress={() => p.onFix(n.id)} />
        </View>
      ))}
      {suggestion ? (
        <>
          <Text style={s.head}>Suggested</Text>
          <View style={s.card}>
            <AppLogo app={suggestion.app.id} name={suggestion.app.name} size={32} />
            <View style={s.text}>
              <Text style={s.title}>{suggestion.title}</Text>
              <Text style={s.quiet}>{suggestion.quiet}</Text>
            </View>
            <Btn
              id={`fp-notnow-${suggestion.id}`}
              label={suggestion.dismiss}
              onPress={() => p.onNotNow(suggestion.id)}
            />
            <Btn
              id={`fp-setup-${suggestion.id}`}
              label={suggestion.action}
              primary
              onPress={() => p.onSetUp(suggestion.id)}
            />
          </View>
        </>
      ) : null}
      <Text style={s.head}>{today.head}</Text>
      <Text style={s.body}>
        {today.parts.map((x, i) =>
          x.t === "link" ? (
            <Text
              key={i}
              testID="fp-today-run"
              accessibilityRole="link"
              onPress={() => p.onSeeRun(x.runId)}
              style={s.link}
            >
              {x.v}
            </Text>
          ) : (
            x.v
          ),
        )}
      </Text>
      <View style={s.ways}>
        <Btn id="fp-new" label="New automation" primary onPress={p.onNew} />
        <Btn id="fp-examples" label="Start from an example" onPress={p.onExamples} />
        <Btn id="fp-allruns" label="All runs" onPress={p.onAllRuns} />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  col: { gap: 10, padding: 24, maxWidth: 760, width: "100%", alignSelf: "center" },
  head: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string, marginTop: 8 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "var(--raised)" as string,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
  },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  quiet: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  body: { fontSize: 13, color: "var(--ink)" as string },
  link: { color: "var(--accent)" as string },
  ways: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 8 },
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
});
