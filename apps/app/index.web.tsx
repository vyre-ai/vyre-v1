// Web entry. The static export still renders every page through expo-router (app/), but the browser hydrates the app root directly: the app keeps its address with
// window.history (UrlSync) and uses no router at run time, and mounting expo-router's navigation container, linking and route tree evaluated some four hundred modules
// between DOMContentLoaded and the first usable frame (phone cold start, 4x CPU). The two Suspense boundaries and the flex view stand where expo-router's navigation
// container, safe-area provider and route put them, so the exported markup hydrates unchanged.
import "@expo/metro-runtime";
import { Suspense, startTransition } from "react";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import registerRootComponent from "expo/build/launch/registerRootComponent";
import { AppRoot } from "./src/startup/AppRoot.tsx";
import { webUiStateStore } from "./src/startup/persisted.ts";
import { resolveLastPlace } from "./src/startup/places.ts";

// "/" opens the last place (app/index.tsx redirects there in the router); the root draws the same frame for every address, so it is done before the first render
const loc = (globalThis as { location?: { pathname: string; search: string; hash: string } }).location;
const hist = (globalThis as { history?: { state: unknown; replaceState(state: unknown, title: string, url: string): void } }).history;
if (loc && hist && loc.pathname === "/") hist.replaceState(hist.state, "", `/${resolveLastPlace(webUiStateStore().read().lastPlace)}${loc.search}${loc.hash}`);

const styles = StyleSheet.create({ container: { flex: 1 } });

function Root(): ReactElement {
  return (
    <Suspense fallback={null}>
      <View style={styles.container}>
        <Suspense fallback={null}>
          <AppRoot />
        </Suspense>
      </View>
    </Suspense>
  );
}

startTransition(() => registerRootComponent(Root));
