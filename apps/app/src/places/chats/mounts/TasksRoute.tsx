// The Tasks route, inside Chats (no Home). The Tasks lane fills this file: today it lists what needs you and your work with Home's own sections, so a link to Tasks always lands somewhere true. One task opens its page.
import { useMemo } from "react";
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { homeData } from "../../../shell/providers/home.tsx";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { HomeDataProvider, MyWork, NeedsYouTop3, SelectionProvider } from "../../home/sections-a/index.ts";
import { TaskLeaf } from "../../home/task/TaskLeaf.tsx";

export function TasksRoute({ rt }: { rt: ShellRuntime }): ReactElement {
  const data = useMemo(() => homeData(rt), [rt]);
  return (
    <HomeDataProvider value={data}>
      <SelectionProvider>
        <ScrollView testID="tasks-route" style={st.root} contentContainerStyle={st.content}>
          <View style={st.col}>
            <Text accessibilityRole="header" aria-level={1} style={st.title}>Tasks</Text>
            <NeedsYouTop3 />
            <MyWork />
          </View>
        </ScrollView>
      </SelectionProvider>
    </HomeDataProvider>
  );
}

export function TaskRouteLeaf({ rt, taskId, onBack }: { rt: ShellRuntime; taskId: string; onBack(): void }): ReactElement {
  const data = useMemo(() => homeData(rt), [rt]);
  return <HomeDataProvider value={data}><TaskLeaf taskId={taskId} onBack={onBack} onOpen={(type, id) => rt.open(type === "task" ? { screen: "tasks.page", args: { taskId: id } } : { subject: { type, id } })} /></HomeDataProvider>;
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  content: { alignItems: "center", paddingHorizontal: 24, paddingTop: 34, paddingBottom: 40 },
  col: { width: "100%", maxWidth: 660 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "600", letterSpacing: -0.5, color: "var(--ink)" as string, marginBottom: 8 },
});
