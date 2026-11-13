// Mount for the one tooltip in the places that went wrong: ?v=dialog (over a control inside a Dialog), ?v=sheet (inside the full-size Sheet), ?v=menu (over an item of an open Menu), ?v=scroll (the middle of a
// long scrolled list, after scrolling), ?v=edge (a control at the right edge of a narrow window). The target carries data-testid tip-target; the shots script hovers it and checks the tip is above everything, at its control, and inside the window.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Dialog } from "../../../ui/src/Dialog/index.tsx";
import { useMenu } from "../../../ui/src/Menu/index.tsx";
import { Switch } from "../../../ui/src/Switch/index.tsx";
import { Tooltip } from "../../../ui/src/Tooltip/index.tsx";
import { installTips } from "../../../ui/src/Tooltip/tips.ts";

export const title = "Tooltip placements";
const none = (): void => undefined;

function Target({ label }: { label: string }): ReactNode {
  return (
    <Tooltip text={`${label}\nWho it is`}>
      <Pressable
        testID="tip-target"
        accessibilityRole="button"
        onPress={none}
        style={{
          height: 32,
          paddingHorizontal: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: "var(--line)" as string,
          justifyContent: "center",
        }}
      >
        <Text style={{ color: "var(--ink)" as string }}>{label}</Text>
      </Pressable>
    </Tooltip>
  );
}

function MenuView(): ReactNode {
  const { element, show } = useMenu();
  useEffect(() => {
    show(
      [{ label: "Open" }, { label: "Delete", disabled: true, reason: "Only the owner can delete this" }],
      120,
      120,
      "other",
    );
  }, []);
  return <View style={{ flex: 1 }}>{element}</View>;
}

function Long(): ReactNode {
  const ref = useRef<ScrollView | null>(null);
  useEffect(() => {
    setTimeout(() => ref.current?.scrollTo({ y: 3000, animated: false }), 200);
  }, []);
  return (
    <ScrollView ref={ref} style={{ height: 600, width: 420 }}>
      {Array.from({ length: 200 }, (_, i) => (
        <View
          key={i}
          style={{
            height: 40,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 12,
          }}
        >
          <Text style={{ color: "var(--ink)" as string }}>{`Row ${i}`}</Text>
          {i === 100 ? <Target label="Row 100 cut name" /> : <View />}
        </View>
      ))}
    </ScrollView>
  );
}

export default function Mount(): ReactNode {
  const v =
    new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("v") ?? "dialog";
  useEffect(() => {
    installTips();
  }, []);
  const wrap = (c: ReactNode): ReactNode => (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string, padding: 24 }}>{c}</View>
  );
  if (v === "dialog")
    return wrap(
      <Dialog title="A dialog" onClose={none} actions={[{ label: "Done", primary: true, onPress: none }]}>
        <Target label="Share with the team" />
      </Dialog>,
    );
  if (v === "sheet")
    return wrap(
      <Dialog title="Terminal" size="full" onClose={none}>
        <View style={{ padding: 24, alignItems: "flex-start" }}>
          <Switch on label="Keep a copy of the files in Vyre" onChange={none} testID="tip-target" />
        </View>
      </Dialog>,
    );
  if (v === "menu") return wrap(<MenuView />);
  if (v === "scroll") return wrap(<Long />);
  return wrap(
    <View style={{ alignItems: "flex-end" }}>
      <Target label="At the right edge" />
    </View>,
  );
}
