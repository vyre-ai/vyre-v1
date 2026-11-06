// The page and the highlighted text a message brought from Vyre for Chrome (apps/chrome side panel, lib/chrome-app.ts chat.ask): a web_page block is a small page card (the site's
// initial, the page title, its host and the masked screenshot the person left in), and a quote block is the selected text with the site it came from. Both read only their own data;
// a screenshot is shown only as a data: image the extension made (password and card fields already blacked out on the person's computer), never fetched from anywhere.
import type { ReactElement } from "react";
import { CARD_INSET, Card } from "../../../../../../ui/src/Card/index.tsx";
import { RADIUS } from "../../../../../../ui/src/tokens/radius.ts";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";

export interface WebPageData { url: string; host: string; title: string; shot: string | null }
export interface QuoteData { text: string; host: string; url: string }

const SHOT = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/** @param {unknown} u */
function hostOf(u: unknown): string {
  try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.hostname.replace(/^www\./, "") : ""; } catch { return ""; }
}

export const isWebPage = (type: string): boolean => type === "web_page";
export const isQuote = (type: string): boolean => type === "quote";

/** A web_page block's data, or null when it names no web page. */
export function webPageOf(data: unknown): WebPageData | null {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const host = hostOf(d["url"]);
  if (!host) return null;
  const shot = typeof d["shot"] === "string" && SHOT.test(d["shot"]) ? d["shot"] : null;
  return { url: String(d["url"]), host, title: typeof d["title"] === "string" && d["title"].trim() ? d["title"].trim().slice(0, 300) : host, shot };
}

/** A quote block's data, or null when it carries no text. */
export function quoteOf(data: unknown): QuoteData | null {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const text = typeof d["text"] === "string" ? d["text"].trim().slice(0, 4000) : "";
  if (!text) return null;
  return { text, host: hostOf(d["url"]), url: hostOf(d["url"]) ? String(d["url"]) : "" };
}

const open = (url: string): void => { if (/^https?:\/\//i.test(url)) void Linking.openURL(url).catch(() => undefined); };

export function WebPageCard({ id, data }: { id: string; data: unknown }): ReactElement | null {
  const p = webPageOf(data);
  if (!p) return null;
  return (
    <Card kind="item" size="compact" testID={`webpage-card-${id}`} label={p.title}>
    <Pressable testID={`webpage-${id}`} accessibilityRole="link" accessibilityLabel={`${p.title}, ${p.host}${p.shot ? ", with a screenshot" : ""}`} onPress={() => open(p.url)} style={({ hovered }: { hovered?: boolean }) => [s.card, hovered && s.hover]}>
      {p.shot ? <Image testID={`webpage-${id}-shot`} source={{ uri: p.shot }} style={s.shot} resizeMode="cover" accessibilityIgnoresInvertColors /> : (
        <View style={s.tile}><Text style={s.tileText}>{(p.host[0] ?? "?").toUpperCase()}</Text></View>
      )}
      <View style={s.words}>
        <Text style={s.title} numberOfLines={1}>{p.title}</Text>
        <Text style={s.host} numberOfLines={1}>{p.shot ? `${p.host} · with screenshot` : p.host}</Text>
      </View>
    </Pressable>
    </Card>
  );
}

export function QuoteCard({ id, data }: { id: string; data: unknown }): ReactElement | null {
  const q = quoteOf(data);
  if (!q) return null;
  return (
    <Card kind="item" size="compact" testID={`quote-${id}`} label={`Selected text${q.host ? ` on ${q.host}` : ""}`}>
      <Text style={s.quoteText} numberOfLines={6}>{q.text}</Text>
      {q.host ? <Text style={s.host} onPress={() => open(q.url)} accessibilityRole="link">{`Selected on ${q.host}`}</Text> : null}
    </Card>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12 },
  hover: { backgroundColor: "var(--sel)" as string },
  shot: { width: 64, height: 42, borderRadius: RADIUS, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "#fff" },
  tile: { width: 42, height: 42, borderRadius: RADIUS, backgroundColor: CARD_INSET, alignItems: "center", justifyContent: "center" },
  tileText: { fontSize: 15, fontWeight: "600", color: "var(--ink-3)" as string },
  words: { flexShrink: 1, minWidth: 0 },
  title: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  host: { fontSize: 11.5, lineHeight: 15, color: "var(--ink-3)" as string, marginTop: 1 },
  quoteText: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
});
