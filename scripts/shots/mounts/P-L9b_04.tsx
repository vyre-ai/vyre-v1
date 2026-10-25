// Mount for P-L9b_04: the conversation over the Northwind sample (Rivera intake with Intake leading and Docs listening). ?v= picks a variant: idle (default), streaming (Intake is writing
// an answer, held part-way), errors (Docs, with the inline error row), plan (a plan card and a question waiting, plan mode on), busy (two agents working and two helpers), nolead
// (nobody leads), closed, long (150 messages). Every control works against the sample replica: a send adds a message and the composer clears, Stop finishes the live steps, a mode
// change moves the lead. chat.post stays out while ?hold=1, so the picture shows a message that is sent but not yet confirmed.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import type { Variant } from "../../../apps/app/src/places/chats/conversation/sample.ts";

export const title = "Chats conversation";

const VARIANTS: readonly Variant[] = ["idle", "streaming", "busy", "errors", "plan", "long", "nolead", "closed"];
const isVariant = (v: string | null): v is Variant => VARIANTS.includes(v as Variant);

export default function Mount(): ReactNode {
  // The query is read after mount: the static export renders the first frame without it, and the client must render that same frame or React leaves the exported markup behind.
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const params = useMemo(() => new URLSearchParams(search ?? ""), [search]);
  const v = params.get("v");
  const hold = params.get("hold") === "1";
  const sample = useMemo(() => {
    const s = createSample(isVariant(v) ? v : "idle");
    if (hold) s.holdPosts();
    return s;
  }, [v, hold]);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <Conversation data={sample.data} />
    </View>
  );
}
