// Shown for a place whose packet has not registered a screen yet. Not a product screen.
import { StyleSheet, Text, View } from "react-native";

export default function PlaceholderPlace({ place }: { place: string }) {
  return (
    <View style={styles.page} accessibilityLabel={`${place} place`}>
      <Text style={styles.title}>{place}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "var(--win)" as string, padding: 24 },
  title: { color: "var(--ink)" as string, fontSize: 20, fontWeight: "600", textTransform: "capitalize" },
});
