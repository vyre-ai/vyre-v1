// One deploy, opened from its row: what it deployed, its four steps with how long each took and its own lines of the log, why it failed with the one button that fixes it, and what can be
// done with it (cancel while it runs, roll back to it, deploy it again). On a desktop it is the right pane; on a phone it takes the page. While the deploy runs the log is read again every
// second and stays at its last line; the step that is running is open.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Status } from "../../../../../../../ui/src/Status/index.tsx";
import type { CapMap } from "../../../../../../../generated/types.ts";
import { useAppsData } from "../data.tsx";
import { Button } from "../editor-ui.tsx";
import { ago } from "../model.ts";
import { FIX_TITLE, STEP_TITLE, clock, depNote, depState, depTitle, isRunning, stepLines, took } from "./model.ts";
import type { Dep, Site, StepKey } from "./model.ts";
import { Chevron, LogLines, StepMark } from "./parts.tsx";

type Log = CapMap["sites.logs"]["out"];

/** The log of one deploy with its steps: read once, and every second while the deploy runs. */
function useDeployLog(siteId: string, dep: Dep): Log {
  const d = useAppsData();
  const [out, setOut] = useState<Log>({ lines: [] });
  const running = isRunning(dep);
  useEffect(() => {
    let live = true;
    const read = (): void => {
      void (
        d.call("sites.logs", { siteId, deploymentId: dep.deploymentId, build: true, tail: 3000 }) as Promise<Log>
      ).then(
        (o) => {
          if (live) setOut(o);
        },
        () => undefined,
      );
    };
    read();
    if (!running) return () => void (live = false);
    const t = setInterval(read, 1000);
    return () => {
      live = false;
      clearInterval(t);
    };
    // the state is in the list: the last read after a deploy ends shows its last lines and its closed steps
  }, [d, siteId, dep.deploymentId, dep.state, running]);
  return out;
}

export interface DeployDetailProps {
  site: Site;
  dep: Dep;
  busy: boolean;
  online: boolean;
  onCancel(): void;
  onRollback(dep: Dep): void;
  onRedeploy(): void;
  onFix(fix: string): void;
  /** A preview's own actions: serve its build as production, take it away, build its branch again. */
  onPromote?(dep: Dep): void;
  onRemove?(dep: Dep): void;
  onRebuild?(dep: Dep): void;
  /** On a phone the page scrolls, so this draws as a plain column. */
  inPage?: boolean;
}

export function DeployDetail({
  site,
  dep,
  busy,
  online,
  onCancel,
  onRollback,
  onRedeploy,
  onFix,
  onPromote,
  onRemove,
  onRebuild,
  inPage = false,
}: DeployDetailProps): ReactElement {
  const d = useAppsData();
  const log = useDeployLog(site.siteId, dep);
  const now = d.clock().now;
  const who = dep.by ? (dep.by === d.me?.id ? "you" : (d.nameOf?.(dep.by) ?? "a teammate")) : null;
  const steps = log.steps ?? dep.steps;
  const split = stepLines(log.lines, log.steps);
  // the step that runs, or the one that failed, is open; a press opens or closes any of them
  const [toggled, setToggled] = useState<Partial<Record<StepKey, boolean>>>({});
  const isOpen = (key: StepKey, state: string): boolean => toggled[key] ?? (state === "running" || state === "failed");
  const state = depState(dep);
  const off = busy || !online;
  const content = (
    <>
      <View style={s.head}>
        <Text style={s.title}>{depTitle(dep)}</Text>
        <Text style={s.note}>{depNote(dep, who, ago(dep.finishedAt ?? dep.at, now), now, false)}</Text>
      </View>
      {dep.state === "failed" && dep.problem ? (
        <Status
          tone="bad"
          label="It failed"
          note={dep.problem}
          testID="site-deploy-problem"
          {...(dep.fix && dep.fix !== "open_logs"
            ? {
                action: {
                  label: FIX_TITLE[dep.fix] ?? "Deploy again",
                  onPress: () => onFix(dep.fix as string),
                  disabled: off,
                },
              }
            : {})}
        />
      ) : null}
      {steps && steps.length > 0 ? (
        <View style={s.steps} testID="site-steps">
          {/* ui-rows-lint: not a list (the four steps of a deploy, each opening its own lines) */}
          {steps.map((st, i) => {
            const lines = split?.[i]?.lines ?? [];
            const open = isOpen(st.key, st.state);
            const time =
              st.state === "running"
                ? clock(now - (st.startedAt ?? dep.at))
                : st.ms !== undefined
                  ? took(st.ms)
                  : st.state === "skipped"
                    ? "Not run"
                    : "";
            return (
              <View key={st.key} style={i > 0 ? s.stepLine : undefined}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${STEP_TITLE[st.key]}, ${st.state === "ok" ? "done" : st.state}`}
                  testID={`site-step-${st.key}`}
                  onPress={() => setToggled((t) => ({ ...t, [st.key]: !open }))}
                  style={({ hovered }: { hovered?: boolean }) => [s.step, hovered === true && s.over]}
                >
                  <StepMark state={st.state} />
                  <Text style={[s.stepName, (st.state === "waiting" || st.state === "skipped") && s.quiet]}>
                    {STEP_TITLE[st.key]}
                  </Text>
                  <Text style={s.stepTime}>{time}</Text>
                  <Chevron open={open} />
                </Pressable>
                {open ? (
                  <View style={s.stepLog}>
                    <LogLines
                      lines={lines}
                      testID={st.state === "running" ? "site-build-log" : `site-step-log-${st.key}`}
                      empty={st.state === "running" ? "Waiting for its first line." : "It printed nothing."}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : (
        <LogLines
          lines={log.lines}
          testID="site-build-log"
          empty={isRunning(dep) ? "Waiting for the server to start the build." : "This deploy kept no log."}
        />
      )}
      <View style={s.actions}>
        {isRunning(dep) ? (
          <Button title="Cancel" testID="site-deploy-cancel" disabled={off} onPress={onCancel} />
        ) : dep.env === "preview" ? (
          <>
            {dep.state === "ready" && dep.url ? (
              <Button title="Open" testID="site-preview-open" onPress={() => d.nav.openUrl?.(dep.url as string)} />
            ) : null}
            {dep.state === "ready" ? (
              <Button
                title="Promote to production"
                primary
                testID="site-preview-promote"
                disabled={off}
                onPress={() => onPromote?.(dep)}
              />
            ) : (
              <Button
                title="Build again"
                testID="site-preview-rebuild"
                disabled={off}
                onPress={() => onRebuild?.(dep)}
              />
            )}
            <Button
              title="Remove preview"
              testID="site-preview-remove"
              disabled={off}
              onPress={() => onRemove?.(dep)}
            />
          </>
        ) : dep.current ? (
          <>
            {site.live && site.url ? <Button title="Open" onPress={() => d.nav.openUrl?.(site.url as string)} /> : null}
            <Button title="Deploy again" disabled={off} onPress={onRedeploy} />
          </>
        ) : dep.state === "ready" ? (
          <Button
            title="Roll back to this"
            primary
            testID={`site-rollback-${dep.deploymentId}`}
            disabled={off}
            onPress={() => onRollback(dep)}
          />
        ) : (
          <Button title="Deploy again" disabled={off} onPress={onRedeploy} />
        )}
      </View>
      <View style={s.facts}>
        <Fact k="State" v={state.word} />
        {dep.finishedAt !== undefined && dep.state !== "stopped" ? (
          <Fact k="Took" v={took(dep.finishedAt - dep.at)} />
        ) : null}
        {dep.commit ? <Fact k="Commit" v={dep.commit.slice(0, 12)} mono /> : null}
        {dep.note ? <Fact k="How it runs" v={dep.note} /> : null}
      </View>
    </>
  );
  if (inPage)
    return (
      <View style={s.inPage} testID="site-deploy-detail">
        {content}
      </View>
    );
  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.body} testID="site-deploy-detail">
      {content}
    </ScrollView>
  );
}

function Fact({ k, v, mono }: { k: string; v: string; mono?: boolean }): ReactElement {
  return (
    <View style={s.fact}>
      <Text style={s.factKey}>{k}</Text>
      <Text selectable style={[s.factValue, mono && s.mono]}>
        {v}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  body: { paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  inPage: { gap: 14 },
  head: { gap: 4 },
  title: { fontSize: 14.5, fontWeight: "600", lineHeight: 20, color: "var(--ink)" as string },
  note: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  steps: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: "var(--line)" as string },
  stepLine: { borderTopWidth: 1, borderColor: "var(--line)" as string },
  step: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 42, paddingHorizontal: 4 },
  over: { backgroundColor: "var(--hover)" as string },
  stepName: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  quiet: { color: "var(--ink-3)" as string },
  stepTime: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  stepLog: { paddingBottom: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  facts: { borderTopWidth: 1, borderColor: "var(--line)" as string },
  fact: {
    flexDirection: "row",
    gap: 10,
    minHeight: 34,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: "var(--line)" as string,
  },
  factKey: { width: 84, fontSize: 12.5, color: "var(--ink-3)" as string },
  factValue: { flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 18, color: "var(--ink)" as string },
  mono: { fontFamily: "var(--mono)" as string, fontSize: 12 },
});
