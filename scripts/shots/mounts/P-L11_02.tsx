// Mount for P-L11_02: a fixed-height screen that writes window.__probes, so the browser probe runner has a real mount to measure in CI.
import { useEffect, useRef } from "react";
import { View, Text } from "react-native";
import { probesReady, setProbe, watchLayoutShift } from "../app/src/probes.ts";

export const title = "Browser probes";

export default function Mount() {
  // navigate is the open of this screen: first render to the first painted frame, not the app's boot.
  const t0 = useRef(performance.now());
  useEffect(() => {
    const stop = watchLayoutShift();
    requestAnimationFrame(() => requestAnimationFrame(() => setProbe("navigate", performance.now() - t0.current)));
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
