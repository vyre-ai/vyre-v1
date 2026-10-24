// Renders one KitScreenDef: a registered builtin component or a declarative layout, with its queries bound to the generated
// hooks, its four states (loading, empty, offline, error), its actions (confirm, undo flag), keys and performance probes.
// The screen fills its slot at a fixed size in every state, so nothing moves when data arrives (layout_shift budget 0).
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { KitScreenDef } from "../types.ts";
import { builtins as defaultBuiltins, type BuiltinRegistry, type KitScreenContext } from "./builtins.ts";
import type { KitEnv } from "./env.ts";
import { Layout } from "./layout.tsx";
import { evalExpr, resolveInputMap, type Scope } from "./pointer.ts";
import { startProbe, type ScreenProbe } from "./probes.ts";
import { createQuerySet, deriveStatus, queryData, type ScreenStatus } from "./queries.ts";
import { compileKeys, matchCombo } from "./keys.ts";
import { SkeletonRows } from "./skeleton.tsx";
import { States } from "../../States/index.tsx";

export interface KitScreenProps {
  def: KitScreenDef;
  env: KitEnv;
  /** Screen state the query inputs and actions point into (/state/<key>). */
  state?: Readonly<Record<string, unknown>>;
  builtins?: BuiltinRegistry;
}

const EMPTY_STATE: Readonly<Record<string, unknown>> = Object.freeze({});

function nextFrame(fn: () => void): () => void {
  const g = globalThis as { requestAnimationFrame?: (cb: () => void) => number; cancelAnimationFrame?: (id: number) => void };
  if (g.requestAnimationFrame) {
    const id = g.requestAnimationFrame(fn);
    return () => g.cancelAnimationFrame?.(id);
  }
  const t = setTimeout(fn, 0);
  return () => clearTimeout(t);
}

/** The action a state's primary button runs: the one named "primary", else the screen's first action. */
export function primaryActionName(def: KitScreenDef): string | undefined {
  if (def.actions.primary) return "primary";
  return Object.keys(def.actions)[0];
}

function isMac(): boolean {
  const nav = (globalThis as { navigator?: { platform?: string } }).navigator;
  return /mac|iphone|ipad/i.test(nav?.platform ?? "");
}

export function KitScreen({ def, env, state = EMPTY_STATE, builtins = defaultBuiltins }: KitScreenProps): ReactElement {
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const failed = useRef(false);
  const probe = useRef<ScreenProbe | null>(null);
  if (probe.current === null) probe.current = startProbe(def);

  const stateKey = JSON.stringify(state);
  const set = useMemo(() => createQuerySet(def, env, { ...state }), [def, env.hooks, env.read, env.online, stateKey, attempt]);
  const snaps = useSyncExternalStore(set.subscribe, set.getSnapshot, set.getSnapshot);
  const status: ScreenStatus = deriveStatus(def, snaps, env.online);
  const scope: Scope = useMemo(() => ({ queries: queryData(snaps), state }), [snaps, state]);

  useEffect(() => nextFrame(() => probe.current?.firstPaint()), []);
  useEffect(() => (status === "loading" ? undefined : nextFrame(() => probe.current?.complete())), [status]);

  const run = useCallback((name: string, row?: unknown) => {
    const action = def.actions[name];
    if (!action) { failed.current = true; setFailure(`${def.id} has no action ${name}`); return; }
    const input = resolveInputMap(action.input, { ...scope, row });
    void (async () => {
      try {
        if (action.confirm && env.confirm && !(await env.confirm(action.confirm))) return;
        if (failed.current) { failed.current = false; setFailure(null); }
        await env.invoke(action, input);
      } catch (e) {
        failed.current = true;
        setFailure(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [def, env, scope]);

  useEffect(() => {
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: never) => void): void; removeEventListener(t: string, f: (e: never) => void): void } }).document;
    if (!doc || !def.keys?.length) return undefined;
    const mac = isMac();
    const combos = compileKeys(def.keys);
    const onKey = (e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault(): void }) => {
      for (const k of combos) {
        if (matchCombo(k.combo, e, mac) && evalExpr(k.when, scope)) { e.preventDefault(); run(k.action); return; }
      }
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [def, scope, run]);

  const ctx: KitScreenContext = { def, scope, status, env, run, action: (n) => def.actions[n] };
  const primary = primaryActionName(def);
  const onPrimary = primary ? () => run(primary) : undefined;
  const Builtin = def.builtin ? builtins.resolve(def.builtin) : undefined;

  const retry = () => { setAttempt((n) => n + 1); env.retry?.(def.id); };
  const primaryAction = (label: string | undefined) => (label && onPrimary ? { action: { label, onPress: onPrimary } } : {});

  let body: ReactElement;
  if (status === "loading") body = <SkeletonRows />;
  else if (status === "error") body = <States kind="error" message={def.states.error.line} retryable onRetry={retry} {...(env.traceId ? { traceId: env.traceId } : {})} />;
  else if (status === "offline") body = <States kind="offline" title={def.states.offline.line} {...primaryAction(def.states.offline.primary)} />;
  else if (status === "empty") body = <States kind="empty" title={def.states.empty.line} {...primaryAction(def.states.empty.primary)} />;
  else if (Builtin) body = <Builtin screen={ctx} />;
  else if (def.layout) body = <Layout node={def.layout} scope={scope} rt={{ screen: ctx, builtins }} />;
  else body = <Text style={styles.missing} testID="kit-missing-builtin">{`${def.builtin ?? def.id} is not available in this build`}</Text>;

  return (
    <View style={styles.screen} accessibilityLabel={def.id} testID={`kit-screen-${def.id}`} aria-busy={status === "loading"}>
      {body}
      {failure ? <Text style={styles.failure} accessibilityRole="alert" testID="kit-action-failure">{failure}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "var(--win)" as string },
  missing: { color: "var(--ink-3)" as string, fontSize: 13, padding: 16 },
  failure: { color: "var(--danger)" as string, fontSize: 13, paddingHorizontal: 16, paddingVertical: 8 },
});
