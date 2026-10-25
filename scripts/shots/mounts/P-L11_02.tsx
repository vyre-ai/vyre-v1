// Mount for P-L11_02: a fixed-height screen that writes window.__probes, so the browser probe runner has a real mount to measure in CI.
import { useEffect } from "react";
import { View, Text } from "react-native";
import { probesReady, setProbe, sinceNavigation, watchLayoutShift } from "../app/src/probes.ts";

export const title = "Browser probes";

export default function Mount() {
  useEffect(() => {
    const stop = watchLayoutShift();
    setProbe("navigate", sinceNavigation());
    setProbe("prefetch", 100);
    const t = setTimeout(() => { stop(); probesReady(); }, 300);
    return () => { clearTimeout(t); stop(); };
  }, []);
  return (
    <View testID="probe-ready" style={{ height: 120, padding: 16 }}>
      <Text>probe sample</Text>
    </View>
  );
}
