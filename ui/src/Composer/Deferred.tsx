// One dynamic Composer module for every product surface. Place loaders preload
// it before declaring Home, Chats, Inbox or Apps usable; direct consumers keep
// a layout-stable fallback until the same module arrives.
import { createElement, lazy, Suspense } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { ComposerProps } from "./index.tsx";
import { installComposer, loadComposer, loadedComposer } from "./load.ts";
import type { ComposerComponent } from "./load.ts";

export { loadComposer } from "./load.ts";

const lazyComposer = (): ReturnType<typeof lazy> => lazy(() => loadComposer().then(
  (component) => ({ default: component }),
  (error: unknown) => {
    LazyComposer = lazyComposer();
    throw error;
  },
));
let LazyComposer = lazyComposer();

export function DeferredComposer(props: ComposerProps): ReactElement {
  const loaded = loadedComposer();
  if (loaded) return createElement(loaded, props);
  const symbols = props.symbols ?? ["plus", "at", "hash", "slash"];
  const fallback = (
    <View testID={props.testID} accessibilityLabel={props.label ?? props.placeholder} style={{ minHeight: props.density === "compact" ? 40 : 44 }}>
      <Text>{props.placeholder}</Text>
      {symbols.includes("plus") ? <Text>Attach a file</Text> : null}
      {symbols.includes("at") ? <Text>(@)</Text> : null}
      {symbols.includes("hash") ? <Text>(#)</Text> : null}
      {symbols.includes("slash") ? <Text>snippets (/)</Text> : null}
    </View>
  );
  return <Suspense fallback={fallback}><LazyComposer {...props} /></Suspense>;
}

/** Server-render unit tests install the same real component synchronously. */
export function installComposerForTests(component: ComposerComponent): void {
  installComposer(component);
}
