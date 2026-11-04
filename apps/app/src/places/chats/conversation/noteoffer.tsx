// "Save as a note?": the card an agent offers when something in the chat is worth keeping (chat.note_offer.make). It shows a preview of the note, Private to you, Save and Not now. Save makes the person's own
// private note, saved from this chat, and the card becomes a quiet "Saved to Notes · Open". Not now closes it. Everyone who reads the chat sees the offer; only the person it was made to has the buttons,
// and the saved line says nothing of what the note holds.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ConversationData } from "./data.tsx";

export const isNoteOffer = (type: string): boolean => type === "note_offer";

export interface NoteOffer { blockId: string; title: string; body: string; state: "offered" | "saved" | "dismissed"; noteId?: string }

/** The offer's fields from a block's data; null when it is not one. */
export function noteOfferOf(data: unknown): NoteOffer | null {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (typeof d["blockId"] !== "string" || typeof d["title"] !== "string" || typeof d["body"] !== "string") return null;
  const state = d["state"] === "saved" || d["state"] === "dismissed" ? d["state"] : "offered";
  return { blockId: d["blockId"], title: d["title"], body: d["body"], state, ...(typeof d["noteId"] === "string" ? { noteId: d["noteId"] } : {}) };
}

export function NoteOfferCard({ id, data, mine, chat, say }: { id: string; data: unknown; /** this reader is who the offer was made to */ mine: boolean; chat: Pick<ConversationData, "call" | "nav" | "threadId">; say?: (text: string) => void }): ReactElement | null {
  const offer = noteOfferOf(data);
  const [done, setDone] = useState<{ state: "saved" | "dismissed"; noteId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!offer) return null;
  const state = done?.state ?? offer.state;
  const noteId = done?.noteId ?? offer.noteId;
  if (state === "dismissed") return null;
  if (state === "saved") {
    return (
      <View testID={`noteoffer-saved-${id}`} style={s.saved}>
        <Text style={s.quiet}>Saved to Notes</Text>
        {mine && noteId && chat.nav.openNote ? <><Text style={s.quiet}>·</Text><Pressable accessibilityRole="link" testID={`noteoffer-open-${id}`} onPress={() => chat.nav.openNote?.(noteId)}><Text style={s.link}>Open</Text></Pressable></> : null}
      </View>
    );
  }
  const answer = (decision: "save" | "dismiss"): void => {
    setBusy(true);
    void Promise.resolve(chat.call("chat.note_offer.answer", { threadId: chat.threadId, blockId: offer.blockId, decision })).then(
      (o) => { const r = o as { state: "saved" | "dismissed"; noteId?: string }; setDone({ state: r.state, ...(r.noteId ? { noteId: r.noteId } : {}) }); },
      () => { setBusy(false); say?.(decision === "save" ? "Could not save the note. Try again." : "Could not close it. Try again."); },
    );
  };
  return (
    <View testID={`noteoffer-${id}`} accessibilityLabel="Save as a note?" style={s.card}>
      <View style={s.head}>
        <Text accessibilityRole="header" style={s.title}>Save as a note?</Text>
        <Text style={s.quiet}>{mine ? "Private to you" : "Offered to someone else in this chat"}</Text>
      </View>
      <View style={s.preview} testID={`noteoffer-preview-${id}`}>
        <Text style={s.pt} numberOfLines={2}>{offer.title}</Text>
        <Text style={s.pb} numberOfLines={5}>{offer.body}</Text>
      </View>
      {mine ? (
        <View style={s.acts}>
          <Pressable accessibilityRole="button" accessibilityLabel="Save" testID={`noteoffer-save-${id}`} disabled={busy} onPress={() => answer("save")} style={[s.btn, s.btnPrimary]}><Text style={[s.btnText, s.btnPrimaryText]}>Save</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Not now" testID={`noteoffer-dismiss-${id}`} disabled={busy} onPress={() => answer("dismiss")} style={s.btn}><Text style={s.btnText}>Not now</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 10, maxWidth: 460, padding: 12, borderRadius: 14, backgroundColor: "var(--raised)" as string, boxShadow: "inset 0 0 0 1px var(--line)" } as object,
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  quiet: { fontSize: 12, color: "var(--ink-3)" as string },
  preview: { marginTop: 10, padding: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
  pt: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  pb: { marginTop: 3, fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  acts: { flexDirection: "row", gap: 8, marginTop: 12 },
  btn: { height: 30, justifyContent: "center", paddingHorizontal: 13, borderRadius: 9 },
  btnPrimary: { backgroundColor: "var(--accent)" as string },
  btnText: { fontSize: 13.5, fontWeight: "600", color: "var(--ink-3)" as string },
  btnPrimaryText: { color: "var(--accent-ink)" as string },
  saved: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8 },
  link: { fontSize: 12, color: "var(--accent)" as string },
});
