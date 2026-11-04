// Mount for lane l-backup (owner, 4 Nov): the top bar's notifications slot, right of the search field. ?part= none, lock, three (three notices; the popover is opened by the target), and ?setup=1 adds the
// "Finish setup" pill on the left. On a phone the slot is a bell with a dot.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View, Text, useWindowDimensions } from "react-native";
import { TitleBar } from "../../../apps/app/src/shell/titlebar/TitleBar.tsx";
import { ResumeContext } from "../../../apps/app/src/onboarding/resume-context.ts";
import { ResumeChip } from "../../../apps/app/src/onboarding/ResumeChip.tsx";
import { notices } from "../../../apps/app/src/shell/noticeslot/model.ts";

export const title = "Top bar notifications slot";

export default function Mount(): ReactNode {
  const [q, setQ] = useState<{ part: string; setup: boolean } | null>(null);
  const width = useWindowDimensions().width;
  useEffect(() => {
    const p = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "");
    setQ({ part: p.get("part") ?? "none", setup: p.get("setup") === "1" });
  }, []);
  useEffect(() => {
    if (!q) return undefined;
    const run = (): void => undefined;
    if (q.part === "lock" || q.part === "three") notices.raise({ id: "locked", kind: "locked", text: "Sign-ins locked", action: { label: "Unlock", run } });
    if (q.part === "three") {
      notices.raise({ id: "update", kind: "update", text: "Vyre 1.0.0-rc.22 is ready", action: { label: "Restart", run } });
      notices.raise({ id: "approval", kind: "approval", text: "An approval is waiting for you", action: { label: "Review", run } });
      notices.raise({ id: "r", kind: "reply", text: "Dana Whitfield replied" });
    }
    return () => { for (const id of ["locked", "update", "approval", "r"]) notices.resolve(id); };
  }, [q]);
  if (!q) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const pill = <ResumeChip flow="personal" progress={{ ai: "done" }} device="mac" compact={width < 640} onOpen={() => undefined} />;
  const bar = <TitleBar title="Vyre, Northwind, Chats" online waiting={0} onOpenWaiting={() => undefined} onSearch={() => undefined} compact={width < 640} />;
  return (
    <View style={{ flex: 1, backgroundColor: "var(--rail)" as string }}>
      {q.setup ? <ResumeContext.Provider value={{ done: 1, total: 9, open: () => undefined, pill }}>{bar}</ResumeContext.Provider> : bar}
      <View style={{ flex: 1, padding: 24, backgroundColor: "var(--win)" as string }}><Text style={{ color: "var(--ink-3)" as string, fontSize: 13 }}>The place under the bar.</Text></View>
    </View>
  );
}
