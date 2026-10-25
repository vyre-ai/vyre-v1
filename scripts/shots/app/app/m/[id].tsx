// Mount route (ruling 29): /m/<packet> renders scripts/shots/mounts/<packet>.tsx full page, so a UI packet can screenshot
// its real components against the prototype. Each UI packet owns its own mount file; this route needs no edit to add one.
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { loadMount, mountIds } from "../../src/mounts.js";

export function generateStaticParams(): { id: string }[] {
  return mountIds().map((id) => ({ id }));
}

export default function MountRoute() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  if (!mountIds().includes(id)) return <View accessibilityRole="alert"><Text>No mount {id}</Text></View>;
  const Mount = loadMount(id).default;
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} testID={`mount-${id}`}>
      <Mount />
    </View>
  );
}
