// A part of the app whose code loads on request, in place of React.lazy (rc.40). Three things React.lazy does not do:
//   one element tree     the part is Boundary > Inner > part before and after its code arrives, so nothing remounts when it does (text typed into it survives)
//   a failure is not kept a chunk that could not be fetched is asked for again on the next draw or on Retry; React.lazy keeps the rejection for the life of the page
//   a failure is local   only that part shows a small "Couldn't load this part" with Retry; the rest of the app stays up. A crash of the page's own code is not this boundary's: it goes on to the next one.
// It is a drop-in for `lazy`: the same argument, and it suspends to the Suspense above it exactly as `lazy` does (so each call site keeps its own fallback).
import { Component } from "react";
import type { ComponentProps, ComponentType, ErrorInfo, ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/** The one error the part's boundary answers: the code of the part could not be fetched. */
export class LoadFailure extends Error {
  constructor(cause: unknown) {
    super(`part failed to load: ${cause instanceof Error ? cause.message.slice(0, 160) : String(cause).slice(0, 160)}`);
    this.name = "LoadFailure";
  }
}

/** One try at loading a part, shared by every draw of it that is waiting: a new one is made at every Retry and when the boundary that showed a failure goes, so a failure is never remembered past the draw that met it. (It is not component state: a part that suspends on its first draw has no state to keep.) */
interface Attempt {
  wait: Promise<void> | null;
  error: unknown;
}
const fresh = (): Attempt => ({ wait: null, error: undefined });

class Boundary extends Component<
  { onRetry: () => void; onGone: () => void; children?: ReactNode },
  { error: unknown }
> {
  override state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }
  override componentWillUnmount(): void {
    this.props.onGone();
  }
  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (error instanceof LoadFailure)
      console.error(`vyre ${error.message} in${(info.componentStack ?? "").replace(/\s+/g, " ").slice(0, 300)}`);
  }
  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (!(error instanceof LoadFailure)) throw error; // the page's own crash: the next boundary reports it
    return (
      <View testID="lazy-part-failed" style={st.box}>
        <Text style={st.line}>Couldn't load this part.</Text>
        <Pressable
          accessibilityRole="button"
          testID="lazy-part-retry"
          onPress={() => {
            this.props.onRetry();
            this.setState({ error: null });
          }}
          style={(state) => [st.btn, (state as { hovered?: boolean }).hovered === true ? st.btnOver : null]}
        >
          <Text style={st.btnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the same bound React.lazy has: any component
type AnyComponent = ComponentType<any>;
/** `load()` as a promise, with no turn added when it returns one (a test that waits a fixed number of turns for a part sees it as it would a React.lazy); a loader that throws before it returns is a rejected load. */
function startLoad<T>(load: () => Promise<T>): Promise<T> {
  try {
    return load();
  } catch (e) {
    return Promise.reject(e);
  }
}

export type LazyPart<T extends AnyComponent> = ((props: ComponentProps<T>) => ReactElement) & {
  preload: () => Promise<void>;
};

/**
 * `load` is what `lazy` takes. `peek` answers the component when something else already loaded it (the shell's module is fetched by the page's own warm-up): then the part draws on its first pass.
 */
export function lazyPart<T extends AnyComponent>(
  load: () => Promise<{ default: T }>,
  peek?: () => T | null | undefined,
): LazyPart<T> {
  type P = ComponentProps<T>;
  let loaded: T | null = null;
  let pending: Promise<T> | null = null;
  const get = (): Promise<T> =>
    (pending ??= Promise.resolve()
      .then(load)
      .then(
        (m) => {
          loaded = m.default;
          return m.default;
        },
        (e: unknown) => {
          pending = null; // a failed load is not kept: the next use asks again
          throw e;
        },
      ));
  let current = fresh();
  function Inner(props: P): ReactElement {
    const attempt = current;
    const Ready = loaded ?? peek?.() ?? null;
    if (!Ready) {
      if (attempt.error !== undefined) throw attempt.error;
      attempt.wait ??= get().then(
        () => undefined,
        (e: unknown) => {
          attempt.error = new LoadFailure(e);
        },
      );
      throw attempt.wait;
    }
    const Draw = Ready as ComponentType<P>;
    return <Draw {...props} />;
  }
  const Part = ((props: P): ReactElement => (
    <Boundary
      onRetry={() => {
        current = fresh();
      }}
      onGone={() => {
        if (current.error !== undefined) current = fresh();
      }}
    >
      <Inner {...props} />
    </Boundary>
  )) as LazyPart<T>;
  Part.preload = () => get().then(() => undefined);
  return Part;
}

const st = StyleSheet.create({
  box: { flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center", gap: 8, padding: 16 },
  line: { fontSize: 13, color: "var(--ink-2)" as string },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
  },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnText: { fontSize: 13, color: "var(--ink)" as string },
});
