// The first page of Automations (design 2.3), drawn from firstPage()'s model: the head, Needs you cards with their fix, at most one suggestion, one Today line, then the ways in. No line explains the page.
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppLogo } from "../../../../../../ui/src/AppLogo/index.tsx";
import { When } from "../../../../../../ui/src/Time/index.tsx";
import type { FirstPage } from "../first/model.ts";
import { look } from "./look.ts";

export interface FirstPageViewProps {
  page: FirstPage;
  /** Now, for the "since when" line of a card. */
  now: number;
  /** "5 on, 2 need you": the count line under the title. */
  summary?: string;
  onFix(needId: string): void;
  onSeeRun(runId: string): void;
  onSetUp(suggestionId: string): void;
  onNotNow(suggestionId: string): void;
  onNew(): void;
  onExamples(): void;
  onAllRuns(): void;
  onAsk?(): void;
  /** One plain line when something the person pressed did not work. */
  note?: string | null;
  /** More things that need him, drawn under the cards (schedule recovery requests). */
  extra?: ReactNode;
}

function Btn({
  id,
  label,
  kind,
  onPress,
}: {
  id: string;
  label: string;
  kind: "primary" | "quiet" | "outlined";
  onPress(): void;
}): ReactElement {
  return (
    <Pressable
      testID={id}
      accessibilityRole="button"
      onPress={onPress}
      style={[look.btn, kind === "primary" ? look.primary : kind === "outlined" ? look.outlined : null]}
    >
      <Text style={kind === "primary" ? look.primaryText : look.btnText}>{label}</Text>
    </Pressable>
  );
}

export function FirstPageView(p: FirstPageViewProps): ReactElement {
  const { needs, suggestion, today } = p.page;
  return (
    <View style={s.page} testID="first-page">
      <View style={s.head}>
        <View style={s.grow}>
          <Text accessibilityRole="header" style={s.h1}>
            Automations
          </Text>
          {p.summary ? <Text style={look.quiet}>{p.summary}</Text> : null}
        </View>
        {p.onAsk ? <Btn id="fp-ask" label="Ask Vyre" kind="quiet" onPress={p.onAsk} /> : null}
        <Btn id="fp-new" label="New automation" kind="primary" onPress={p.onNew} />
      </View>
      <ScrollView contentContainerStyle={s.col}>
        {p.note ? (
          <Text testID="fp-note" style={look.warn}>
            {p.note}
          </Text>
        ) : null}
        {needs.length > 0 ? <Text style={look.heading}>Needs you</Text> : null}
        {/* ui-rows-lint: not a list (Needs you cards, each with its own fix) */}
        {needs.map((n) => (
          <View key={n.id} style={look.card}>
            <AppLogo app={n.app ?? "vyre:logic"} name={n.automation} size={32} />
            <View style={s.grow}>
              <Text style={look.title}>{n.automation}</Text>
              <Text style={[look.body, { color: "var(--ink-2)" }]}>{n.why}</Text>
              <When at={n.at} now={p.now} testID={`fp-when-${n.id}`} style={look.quiet} />
            </View>
            {n.runId ? (
              <Btn
                id={`fp-run-${n.id}`}
                label={n.fix.kind === "approve" ? "Look first" : "See the run"}
                kind="quiet"
                onPress={() => p.onSeeRun(n.runId!)}
              />
            ) : null}
            <Btn id={`fp-fix-${n.id}`} label={n.fix.label} kind="primary" onPress={() => p.onFix(n.id)} />
          </View>
        ))}
        {p.extra}
        {suggestion ? (
          <>
            <Text style={[look.heading, s.gap]}>Suggested</Text>
            <View style={look.card}>
              <AppLogo app={suggestion.app.id} name={suggestion.app.name} size={32} />
              <View style={s.grow}>
                <Text style={look.title}>{suggestion.title}</Text>
                <Text style={look.body}>{suggestion.quiet}</Text>
              </View>
              <Btn
                id={`fp-notnow-${suggestion.id}`}
                label={suggestion.dismiss}
                kind="quiet"
                onPress={() => p.onNotNow(suggestion.id)}
              />
              <Btn
                id={`fp-setup-${suggestion.id}`}
                label={suggestion.action}
                kind="primary"
                onPress={() => p.onSetUp(suggestion.id)}
              />
            </View>
          </>
        ) : null}
        <Text style={[look.heading, s.gap]}>{today.head}</Text>
        <Text style={look.body}>
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
          <Btn id="fp-examples" label="Start from an example" kind="outlined" onPress={p.onExamples} />
          <Btn id="fp-allruns" label="All runs" kind="outlined" onPress={p.onAllRuns} />
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, width: "100%" },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  h1: { fontSize: 17, fontWeight: "600", color: "var(--ink)" as string },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  col: { gap: 10, paddingVertical: 24, paddingHorizontal: 16, maxWidth: 690, width: "100%", alignSelf: "center" },
  gap: { marginTop: 14 },
  link: { color: "var(--accent)" as string, textDecorationLine: "underline" },
  ways: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 10 },
});
