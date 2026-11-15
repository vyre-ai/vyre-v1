// Mount for the one sheet frame: ?size=s|m|l|full. ?keys=1 is the full sheet that captures the keyboard (a terminal): header, the bar under it, the chord in plain words and Close. The body here is a stand-in for the live surface.
import { useState } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Dialog } from "../../../ui/src/Dialog/index.tsx";
import { closeChord } from "../../../ui/src/Dialog/sheet-keys.ts";

export const title = "The one sheet frame";

export default function Mount(): ReactNode {
  const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "");
  const size = (["s", "m", "l", "full"] as const).find((x) => x === q.get("size")) ?? "full";
  const keys = q.get("keys") === "1";
  const [open, setOpen] = useState(true);
  if (!open) return <View style={{ flex: 1 }} />;
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <Dialog
        title="Dex's terminal"
        size={size}
        {...(size === "full"
          ? {
              header: (
                <View>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: "var(--ink)" as string }}>
                    build, in Dex's computer
                  </Text>
                  <Text style={{ fontSize: 12, color: "var(--ink-3)" as string }}>Dex, owned by Dana</Text>
                </View>
              ),
              bar: <Text style={{ fontSize: 12.5, color: "var(--ink-3)" as string }}>Nobody is typing</Text>,
            }
          : {
              note: "This does not delete the files.",
              actions: [
                { label: "Cancel", onPress: () => setOpen(false) },
                { label: "Close session", danger: true, onPress: () => setOpen(false) },
              ],
            })}
        {...(keys ? { captureKeys: closeChord(false) } : {})}
        onClose={() => setOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: "#111" as string, padding: 16 }}>
          <Text style={{ color: "#9f9" as string, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }}>
            {"$ npm run build\n> built in 4.2s"}
          </Text>
        </View>
      </Dialog>
    </View>
  );
}
