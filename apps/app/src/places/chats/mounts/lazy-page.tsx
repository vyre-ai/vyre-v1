// A page loaded on first draw; once loaded it is drawn directly. One stable element tree either way (Boundary > Suspense > Inner > page): when the chunk arrives while the page is already on screen,
// nothing remounts, so text typed into it survives (rc.39 drew Lazy first and Loaded after: a different element type, so the page remounted and dropped typed text).
// A chunk that fails to load (a dropped connection, a deploy that moved the file) is never cached: the next use asks again. The part that failed shows one quiet line with Retry in its own place;
// the rest of the Chats place stays up.
import { Component, Suspense, useCallback, useState } from "react";
import type { ComponentType, ErrorInfo, ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/** One try at loading this part: a new one is made for every fresh draw and for every Retry, so a failure is never remembered past the draw that met it. */
interface Attempt {
  wait: Promise<void> | null;
  error: unknown;
}

class Boundary extends Component<
  { onRetry: () => void; children?: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `vyre part failed to load: ${error.message.slice(0, 160)} in${(info.componentStack ?? "").replace(/\s+/g, " ").slice(0, 300)}`,
    );
  }
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <View testID="lazy-part-failed" style={st.box}>
        <Text style={st.line}>Couldn't load this part.</Text>
        <Pressable
          accessibilityRole="button"
          testID="lazy-part-retry"
          onPress={() => {
            this.props.onRetry();
            this.setState({ failed: false });
          }}
          style={(state) => [st.btn, (state as { hovered?: boolean }).hovered === true ? st.btnOver : null]}
        >
          <Text style={st.btnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }
}

export function lazyPage<P extends object>(
  load: () => Promise<ComponentType<P>>,
): {
  Draw: (props: P) => ReactElement;
  preload: () => Promise<void>;
} {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const get = (): Promise<ComponentType<P>> =>
    (pending ??= load().then(
      (c) => {
        loaded = c;
        return c;
      },
      (e: unknown) => {
        pending = null; // a failed load is not kept: the next use asks again
        throw e;
      },
    ));
  function Inner(props: P & { attempt: Attempt }): ReactElement {
    const { attempt, ...rest } = props;
    if (!loaded) {
      if (attempt.error !== undefined) throw attempt.error;
      attempt.wait ??= get().then(
        () => undefined,
        (e: unknown) => {
          attempt.error = e ?? new Error("part failed to load");
        },
      );
      throw attempt.wait;
    }
    const Loaded = loaded;
    return <Loaded {...(rest as unknown as P)} />;
  }
  function Draw(props: P): ReactElement {
    const [attempt, setAttempt] = useState<Attempt>(() => ({ wait: null, error: undefined }));
    const retry = useCallback(() => setAttempt({ wait: null, error: undefined }), []);
    return (
      <Boundary onRetry={retry}>
        <Suspense fallback={null}>
          <Inner {...(props as P)} attempt={attempt} />
        </Suspense>
      </Boundary>
    );
  }
  return {
    Draw,
    // preloading is best effort: a failure here is not an error on screen, and the draw asks again itself
    preload: () => get().then(() => undefined),
  };
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
