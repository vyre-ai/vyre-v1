// Mount for P-L9c_05: a live call inside its conversation (Northwind sample Space). ?c=elena|marcus is the conversation (default elena), ?phase=live|ended the call (default live), ?where=list shows the
// same call from the Unmatched list, where the floating dock is the only call surface. The call is driven the way a person does: it rings, the Accept button is pressed, and for ended the end button.
// State is read after mount (rule 25), so the static export never shows a stale one.
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { InboxDataProvider, InboxSidebar, InboxStateProvider } from "../../../apps/app/src/places/inbox/sidebar/index.ts";
import { InboxPhoneDock } from "../../../apps/app/src/places/inbox/softphone/index.ts";
import { InboxUnmatched } from "../../../apps/app/src/places/inbox/unmatched/index.ts";
import { CallConversation } from "../../../apps/app/src/places/inbox/callpane/index.ts";
import { createUnmatchedSample } from "../../../apps/app/src/places/inbox/unmatched/sample.ts";
import { PHONE_OF } from "../../../apps/app/src/places/inbox/softphone/sample.ts";

export const title = "Inbox call";

type Doc = { querySelector(s: string): { click?: () => void } | null };
const click = (id: string): void => (globalThis as { document?: Doc }).document?.querySelector(`[data-testid="${id}"]`)?.click?.();
const TASKS = { elena: [{ title: "Send the lease draft", due: "Today" }, { title: "Reply to Marcus", due: "Fri" }], marcus: [{ title: "Reconcile invoice 1041", due: "Today" }] } as const;

export default function Mount(): ReactNode {
  const q = useMemo(() => new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const sample = useMemo(() => createUnmatchedSample(), []);
  const who = (q.get("c") === "marcus" ? "marcus" : "elena") as "elena" | "marcus";
  const contactId = who === "marcus" ? "ct_marcus" : "ct_elena";
  const list = q.get("where") === "list";
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => { sample.device.ring(PHONE_OF[who]!); }, 400));
    timers.push(setTimeout(() => click("softphone-answer"), 800));
    if (q.get("phase") === "ended") timers.push(setTimeout(() => click("softphone-hangup"), 1500));
    return () => { for (const t of timers) clearTimeout(t); };
  }, [q, sample, who]);
  return (
    <InboxDataProvider value={sample.data}>
      <InboxStateProvider initial={{}}>
        <InboxPhoneDock device={sample.device} placement="dock">
          <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
            <View style={{ width: 240 }}><InboxSidebar /></View>
            {list ? <InboxUnmatched /> : <CallConversation conversationId={who} contactId={contactId} tasks={TASKS[who]} />}
          </View>
        </InboxPhoneDock>
      </InboxStateProvider>
    </InboxDataProvider>
  );
}
