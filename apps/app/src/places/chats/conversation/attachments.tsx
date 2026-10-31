// Files and links inside a message. A file attached to a message is a chip: its real name and size, a click opens it beside the chat, a right-click offers Open and Copy name. A [[link]] in the
// text is the thing it points at: hover shows what it is, a click opens it. Both look the thing up once and keep the answer, so a long chat asks a handful of times, not once per row.
import { memo, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { AppIcon } from "../../../../../../ui/src/AppIcon/index.tsx";
import { Overlay } from "../../../../../../ui/src/Overlay/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConversationData } from "./data.tsx";
import { Glyph } from "./parts.tsx";
import type { GlyphName } from "./parts.tsx";
import { PENDING_FILE, collect } from "./model.ts";
import { BRAND_OF_MOUNT } from "./suggest.ts";
import type { Message } from "./model.ts";

type FileRow = CapMap["files.get"]["out"]["file"];


export function sizeLine(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 104857.6) / 10} MB`;
  return `${Math.round(bytes / 107374182.4) / 10} GB`;
}

const files = new WeakMap<object, Map<string, Promise<FileRow | null>>>();
function lookup(data: Pick<ConversationData, "call">, id: string): Promise<FileRow | null> {
  let m = files.get(data.call);
  if (!m) { m = new Map(); files.set(data.call, m); }
  let p = m.get(id);
  if (!p) { p = Promise.resolve(data.call("files.get", { fileId: id })).then((r) => (r as CapMap["files.get"]["out"]).file, () => null); m.set(id, p); }
  return p;
}

type MountRow = CapMap["mounts.list"]["out"]["mounts"][number];

const mountLists = new WeakMap<object, { at: number; p: Promise<MountRow[]> }>();
/** The Space's mounts, asked for once a few seconds at a time, so a chat full of chips asks once and not once per row. */
function mountsOf(data: Pick<ConversationData, "call">): Promise<MountRow[]> {
  const hit = mountLists.get(data.call);
  if (hit && Date.now() - hit.at < 10_000) return hit.p;
  const p = Promise.resolve(data.call("mounts.list", {})).then((o) => (o as CapMap["mounts.list"]["out"]).mounts, () => [] as MountRow[]);
  mountLists.set(data.call, { at: Date.now(), p });
  return p;
}

/** Where a file or folder comes from, when it is in a mount: the provider's logo and the mount's name. Null for anything that is not mounted. */
export interface MountOrigin { brand: string | undefined; provider: string; mount: string }

export function originOf(mounts: readonly MountRow[], from: { mountId?: string; folderId?: string }): MountOrigin | null {
  const m = mounts.find((x) => (from.mountId !== undefined && x.mountId === from.mountId) || (from.folderId !== undefined && x.folderId === from.folderId));
  return m ? { brand: BRAND_OF_MOUNT[m.kind], provider: m.provider, mount: m.name } : null;
}

function useOrigin(data: Pick<ConversationData, "call">, from: { mountId?: string; folderId?: string } | null): MountOrigin | null {
  const [o, setO] = useState<MountOrigin | null>(null);
  const key = from ? `${from.mountId ?? ""}:${from.folderId ?? ""}` : "";
  useEffect(() => {
    if (!from) { setO(null); return undefined; }
    let live = true;
    void mountsOf(data).then((rows) => { if (live) setO(originOf(rows, from)); });
    return () => { live = false; };
  }, [data, key]);
  return o;
}

/** The provider's logo and mount name on a chip: "Google Drive · Sales". */
function OriginLine({ o }: { o: MountOrigin }): ReactElement {
  return (
    <View style={st.origin} testID="chip-origin">
      {o.brand ? <AppIcon brand={o.brand} size={16} name={o.provider} /> : null}
      <Text numberOfLines={1} style={st.sub}>{`${o.provider} \u00b7 ${o.mount}`}</Text>
    </View>
  );
}

/** A thing linked with # in a message that lives in a mount: a chip with the provider logo and the mount's name, a click opens it beside the chat. Other links draw nothing here. */
export const MountRefs = memo(function MountRefs({ refs, data }: { refs: readonly LinkRef[]; data: Pick<ConversationData, "call" | "nav"> }): ReactElement | null {
  const things = refs.filter((r) => r.kind === "file" || r.kind === "folder");
  if (things.length === 0) return null;
  return <View testID="mount-refs" style={st.row}>{collect(things, (r) => <MountRef key={`${r.kind}:${r.id}`} r={r} data={data} />)}</View>;
});

function MountRef({ r, data }: { r: LinkRef; data: Pick<ConversationData, "call" | "nav"> }): ReactElement | null {
  const [file, setFile] = useState<FileRow | null | undefined>(r.kind === "file" ? undefined : null);
  useEffect(() => {
    if (r.kind !== "file") return undefined;
    let live = true;
    void lookup(data, r.id).then((f) => { if (live) setFile(f); });
    return () => { live = false; };
  }, [data, r.id, r.kind]);
  const from = r.kind === "folder" ? { folderId: r.id } : file?.source ? { mountId: file.source.mountId } : null;
  const origin = useOrigin(data, from);
  if (!origin) return null;
  return (
    <Pressable testID={`mount-ref-${r.id}`} accessibilityRole="button" accessibilityLabel={`Open ${r.title}, from ${origin.provider}`} onPress={() => data.nav.openBeside(r.kind, r.id)} style={st.chip}>
      <Glyph name="file" size={14} color="var(--ink-3)" />
      <View style={st.chipText}>
        <Text numberOfLines={1} style={st.name}>{r.title}</Text>
        <OriginLine o={origin} />
      </View>
    </Pressable>
  );
}

/** The chips under a message's text. */
export const AttachmentChips = memo(function AttachmentChips({ ids, data, menu }: { ids: readonly string[]; data: Pick<ConversationData, "call" | "nav" | "copy">; menu: (items: readonly MenuEntry[], x: number, y: number, label: string) => void }): ReactElement | null {
  if (ids.length === 0) return null;
  return (
    <View testID="attachments" style={st.row}>
      {collect(ids, (id) => <Chip key={id} id={id} data={data} menu={menu} />)}
    </View>
  );
});

function Chip({ id, data, menu }: { id: string; data: Pick<ConversationData, "call" | "nav" | "copy">; menu: (items: readonly MenuEntry[], x: number, y: number, label: string) => void }): ReactElement {
  const pending = id.startsWith(PENDING_FILE);
  const [file, setFile] = useState<FileRow | null | undefined>(pending ? null : undefined);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (pending) return undefined;
    let live = true;
    void lookup(data, id).then((f) => { if (live) setFile(f); });
    return () => { live = false; };
  }, [data, id, pending]);
  const name = pending ? id.slice(PENDING_FILE.length) : file === undefined ? "Loading" : file?.name ?? "File you cannot open";
  const sub = file ? sizeLine(file.size) : pending ? "Sending" : "";
  const origin = useOrigin(data, file?.source ? { mountId: file.source.mountId } : null);
  const icon: GlyphName = file?.mime.startsWith("image/") ? "file" : "file";
  const open = (): void => { if (file) data.nav.openBeside("file", id); };
  return (
    <Pressable
      testID={`attachment-${id}`} accessibilityRole="button" accessibilityLabel={`Open ${name}`} disabled={!file} onPress={open}
      {...menuTrigger((x, y) => menu([{ label: "Open", onSelect: open }, { label: "Copy Name", onSelect: () => data.copy(name) }], x, y, "File"))}
      {...(Platform.OS === "web" ? ({ onHoverIn: () => setOver(true), onHoverOut: () => setOver(false) } as object) : {})}
      style={[st.chip, over && file ? st.chipOver : null, !file && !pending ? st.chipOff : null]}
    >
      <Glyph name={icon} size={14} color="var(--ink-3)" />
      <View style={st.chipText}>
        <Text numberOfLines={1} style={st.name}>{name}</Text>
        {sub ? <Text style={st.sub}>{sub}</Text> : null}
        {origin ? <OriginLine o={origin} /> : null}
      </View>
    </Pressable>
  );
}

/* ---------- [[links]] ---------- */

export interface LinkRef { kind: string; id: string; title: string }

const kindName: Record<string, string> = { record: "Record", file: "File", folder: "Folder", channel: "Channel" };

const previews = new WeakMap<object, Map<string, Promise<{ title: string; line: string } | null>>>();
function preview(data: Pick<ConversationData, "call">, r: LinkRef): Promise<{ title: string; line: string } | null> {
  let m = previews.get(data.call);
  if (!m) { m = new Map(); previews.set(data.call, m); }
  const key = `${r.kind}:${r.id}`;
  let p = m.get(key);
  if (!p) {
    p = Promise.resolve(data.call("search.resolve", { kind: r.kind, itemId: r.id })).then(
      (out) => {
        const hit = (out as CapMap["search.resolve"]["out"]).hit;
        if (!hit) return null;
        return { title: hit.title, line: [hit.recordType, hit.path, hit.snippet].filter((x): x is string => typeof x === "string" && x !== "").join(" · ").slice(0, 160) };
      },
      () => null,
    );
    m.set(key, p);
  }
  return p;
}

/** The refs a message carries (the `refs` block). */
export function refsOf(m: Pick<Message, "blocks">): LinkRef[] {
  const out: LinkRef[] = [];
  for (const b of m.blocks) {
    if (b.type !== "refs" || typeof b.data !== "object" || b.data === null) continue;
    const list = (b.data as { refs?: unknown }).refs;
    if (!Array.isArray(list)) continue;
    for (const r of list) {
      const x = r as Partial<LinkRef>;
      if (typeof x.kind === "string" && typeof x.id === "string" && typeof x.title === "string") out.push({ kind: x.kind, id: x.id, title: x.title });
    }
  }
  return out;
}

/** Splits text at [[Title]] marks: plain pieces and the marks, in order. */
export function splitLinks(body: string): Array<{ text: string; link?: string }> {
  const out: Array<{ text: string; link?: string }> = [];
  let at = 0;
  for (const m of body.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: body.slice(at, i) });
    out.push({ text: m[0], link: (m[1] ?? "").trim() });
    at = i + m[0].length;
  }
  if (at < body.length) out.push({ text: body.slice(at) });
  return out;
}

/** Text with its [[links]] drawn as the things they name. A mark with no ref (typed by hand, or the thing is gone) stays as plain text. */
export const LinkedText = memo(function LinkedText({ body, refs, data, textStyle }: { body: string; refs: readonly LinkRef[]; data: Pick<ConversationData, "call" | "nav">; textStyle: object }): ReactElement {
  const pieces = splitLinks(body);
  return (
    <Text selectable style={textStyle}>
      {collect(pieces, (p, i) => {
        const ref = p.link ? refs.find((r) => r.title === p.link) : undefined;
        if (!ref) return p.link ? p.link : p.text;
        return <LinkPiece key={`${i}:${ref.id}`} r={ref} data={data} />;
      })}
    </Text>
  );
});

function LinkPiece({ r, data }: { r: LinkRef; data: Pick<ConversationData, "call" | "nav"> }): ReactElement {
  const [card, setCard] = useState<{ title: string; line: string } | null | undefined>(undefined);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const web = Platform.OS === "web";
  const reveal = (e: unknown): void => {
    const box = (e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }).currentTarget?.getBoundingClientRect?.();
    setAt(box ? { x: box.left, y: box.bottom + 6 } : { x: 0, y: 0 });
    if (card === undefined) void preview(data, r).then(setCard);
  };
  return (
    <>
      <Text
        testID={`link-${r.id}`} accessibilityRole="link" accessibilityLabel={`${kindName[r.kind] ?? "Link"}: ${r.title}`} onPress={() => data.nav.openBeside(r.kind, r.id)}
        {...(web ? ({ onMouseEnter: reveal, onMouseLeave: () => setAt(null), onFocus: reveal, onBlur: () => setAt(null), tabIndex: 0 } as object) : {})}
        style={st.link}
      >
        {r.title}
      </Text>
      {at ? (
        <Overlay>
          <View testID={`link-card-${r.id}`} accessibilityRole="text" pointerEvents="none" style={[st.card, { left: at.x, top: at.y }]}>
            <Text style={st.cardKind}>{kindName[r.kind] ?? "Link"}</Text>
            <Text numberOfLines={2} style={st.cardTitle}>{card === undefined ? r.title : card?.title ?? r.title}</Text>
            <Text numberOfLines={3} style={st.cardLine}>{card === undefined ? "Loading" : card === null ? "You cannot open this" : card.line || "Open beside the chat"}</Text>
          </View>
        </Overlay>
      ) : null}
    </>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 8, maxWidth: 280, minHeight: 36, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--side)" as string },
  chipOver: { backgroundColor: "var(--hover)" as string, borderColor: "var(--line-2)" as string },
  chipOff: { opacity: 0.6 },
  chipText: { flexShrink: 1, minWidth: 0 },
  name: { fontSize: 13, color: "var(--ink)" as string },
  origin: { flexDirection: "row", alignItems: "center", gap: 5 },
  sub: { fontSize: 11.5, color: "var(--ink-3)" as string },
  card: { position: "absolute", width: 280, gap: 2, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string, boxShadow: "0 8px 28px rgba(0,0,0,.18)" } as object,
  cardKind: { fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--ink-4)" as string },
  cardTitle: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  cardLine: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  link: { color: "var(--accent)" as string, textDecorationLine: "underline", textDecorationColor: "var(--accent-wash)" as string, cursor: "pointer" } as object,
});
