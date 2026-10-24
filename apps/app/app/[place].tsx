// One route per place. The place module is a dynamic import, so only the active place's chunk loads (ARCH 7).
// app.usable fires once the place has drawn; the connection is opened afterwards (see src/startup/startup.ts).
import { Suspense, lazy, useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { mark } from "../src/startup/marks.ts";
import { webUiStateStore } from "../src/startup/persisted.ts";
import { PLACES, isPlace, loaderFor } from "../src/startup/places.ts";

export function generateStaticParams(): { place: string }[] {
  return PLACES.map((place) => ({ place }));
}

/** Rendered next to the place inside Suspense, so its effect runs only after the place module has loaded and drawn. */
function Usable({ place }: { place: string }) {
  useEffect(() => {
    webUiStateStore().write({ lastPlace: place });
    mark("app.usable");
  }, [place]);
  return null;
}

export default function PlaceRoute() {
  const { place = "home" } = useLocalSearchParams<{ place: string }>();
  const Place = useMemo(() => lazy(loaderFor(place)), [place]);
  if (!isPlace(place)) return <View accessibilityRole="alert"><Text>No place called {place}</Text></View>;
  return (
    <Suspense fallback={null}>
      <Place place={place} />
      <Usable place={place} />
    </Suspense>
  );
}
