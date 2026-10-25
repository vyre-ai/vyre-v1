// Open the last place from persisted UI state (a synchronous read), else Home. No network, no await.
import { Redirect } from "expo-router";
import { webUiStateStore } from "../src/startup/persisted.ts";
import { resolveLastPlace } from "../src/startup/places.ts";

export default function Index() {
  const place = resolveLastPlace(webUiStateStore().read().lastPlace);
  return <Redirect href={`/${place}`} />;
}
