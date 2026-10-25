// Mount for P-L9b_08: the computer popup over the Northwind sample Space, with Intake's computer working (default), ?v=asleep, or ?v=takeover (in your control). ?state=recording
// shows a recording 23 seconds in (take over first), ?state=sheet the sheet that asks what Intake should do with it, ?chat=1 the chat beside the screen. Every control works
// against the sample replica: Take over and Give back, Record and Stop, the sheet's choices, Send, Save Only and Discard; Close does nothing here (the shell closes it).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { ComputerPopup } from "../../../apps/app/src/places/chats/computer/ComputerPopup.tsx";
import type { PopupInitial } from "../../../apps/app/src/places/chats/computer/ComputerPopup.tsx";
import { SAMPLE_NOW, createSample } from "../../../apps/app/src/places/chats/computer/sample.ts";
import type { Variant } from "../../../apps/app/src/places/chats/computer/sample.ts";

export const title = "Computer popup";

export default function Mount(): ReactNode {
  // The query is read after mount: the static export renders the first frame without it, and the client must render that same frame or React leaves the exported markup behind.
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const params = useMemo(() => new URLSearchParams(search ?? ""), [search]);
  const state = params.get("state");
  const v = params.get("v");
  const variant: Variant = state === "recording" || state === "sheet" || v === "takeover" ? "takeover" : v === "asleep" ? "asleep" : "working";
  const sample = useMemo(() => {
    const s = createSample(variant);
    s.capture.set({ clicks: 14, pages: 3, requests: 52 });
    return s;
  }, [variant]);
  const initial: PopupInitial = useMemo(() => ({
    ...(params.get("chat") === "1" ? { chat: true } : {}),
    ...(state === "recording" ? { recording: { recordingId: "rec_1", startedAt: SAMPLE_NOW - 23_000 } } : {}),
    ...(state === "sheet" ? { sheet: { recording: { recordingId: "rec_1", computerId: "cmp_intake", agentId: "agt_intake", startedAt: SAMPLE_NOW - 23_000, endedAt: SAMPLE_NOW, durationMs: 23_000, folderPath: "Agents/Intake/work/recordings/2025-10-24-1000", state: "saved" as const, intents: [] }, capture: { clicks: 14, pages: 3, requests: 52 }, secs: 23 } } : {}),
  }), [params, state]);
  const [open, setOpen] = useState(true);
  const data = useMemo(() => ({
    ...sample.data,
    nav: { close: () => setOpen(false) },
    renderChat: (a: { agentId: string; name: string }) => <Text style={{ color: "var(--ink-3)" as string, fontSize: 13, textAlign: "center" }}>{`Talk to ${a.name} while you watch.`}</Text>,
  }), [sample]);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}>{open ? <ComputerPopup data={data} initial={initial} /> : <Text style={{ margin: 24, color: "var(--ink-3)" as string }}>Closed</Text>}</View>;
}
