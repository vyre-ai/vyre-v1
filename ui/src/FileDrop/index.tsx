// ui/FileDrop: one way to take files that are dropped or pasted, for every field that can hold one (the chat composer, comments, quick add, Inbox replies, Files, a record's
// files). react-native-web keeps only the props it knows on a View or a TextInput, and drag and paste events are not among them, so a handler given to a View never reaches
// the page. The zone here is a real element: a box (DropZone) or, around something that already has its own box, an element with no box of its own (DropHost), so the
// layout is unchanged. Paste bubbles up from the field inside, so the same element takes Cmd-V of a screenshot or of files copied in Finder.
// A drop on a place with no zone does nothing: guardFileDrops stops the page from opening the file in place of the app.
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

/** A browser File, as far as Vyre reads it. */
export interface DroppedFile { name: string; size?: number; type?: string; arrayBuffer?: () => Promise<ArrayBuffer> }

interface ItemLike { kind?: string; type?: string; getAsFile?: () => DroppedFile | null }
/** The part of a DataTransfer (a drop, or a paste's clipboardData) read here. */
export interface TransferLike {
  types?: ArrayLike<string> | readonly string[];
  files?: ArrayLike<DroppedFile> | null;
  items?: ArrayLike<ItemLike> | null;
  getData?: (type: string) => string;
  dropEffect?: string;
}

export const DROP_LINE = "Drop to attach";

const list = <T,>(x: ArrayLike<T> | readonly T[] | null | undefined): T[] => (x ? Array.from(x as ArrayLike<T>) : []);

/** True when what is dragged holds files (a Finder file, a screenshot thumbnail, an image from a browser). Text and in-app rows are not files. */
export function carriesFiles(dt: TransferLike | null | undefined): boolean {
  if (!dt) return false;
  if (list(dt.types).includes("Files")) return true;
  return list(dt.files).length > 0 || list(dt.items).some((i) => i.kind === "file");
}

/** The files in a drop or a paste: `files`, else the file items (some engines fill only one of the two). The same file is never taken twice. */
export function filesIn(dt: TransferLike | null | undefined): DroppedFile[] {
  if (!dt) return [];
  const out = list(dt.files);
  if (out.length > 0) return out;
  for (const item of list(dt.items)) {
    if (item.kind !== "file") continue;
    const f = item.getAsFile?.();
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

/**
 * The files a paste carries. A copy from a document (Word, Excel, Pages, a web page) also puts a picture of the words on the clipboard; there the words are what was meant,
 * so a paste with both rich text and plain text pastes the text. A screenshot, an image copied from a browser and files copied in Finder come through as files.
 */
export function pastedFiles(cd: TransferLike | null | undefined): DroppedFile[] {
  if (!cd) return [];
  const types = list(cd.types);
  const plain = types.includes("text/plain") ? (cd.getData?.("text/plain") ?? "") : "";
  if (types.includes("text/html") && plain.trim() !== "") return [];
  return filesIn(cd);
}

/** A pasted screenshot has no name of its own (or the engine calls it image.png): it gets one a person can read. */
export function pastedName(f: DroppedFile, at: Date = new Date()): string {
  if (f.name && f.name !== "image.png" && f.name !== "image") return f.name;
  const ext = (f.type ?? "").startsWith("image/") ? (f.type ?? "").slice(6).replace("jpeg", "jpg").replace(/\+.*$/, "") || "png" : "png";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `Pasted image ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} at ${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}.${ext}`;
}

interface DragEventLike { dataTransfer?: TransferLike | null; preventDefault(): void; stopPropagation?(): void }
interface PasteEventLike { clipboardData?: TransferLike | null; preventDefault(): void; stopPropagation?(): void }

export interface FileDropOptions {
  /** Take files dropped here. Default true. */
  drop?: boolean;
  /** Take files pasted into a field inside. Default true. */
  paste?: boolean;
  /** Off: nothing is taken (a locked or read-only field). The drop still does not open the file in the window. */
  enabled?: boolean;
  /** A drag that is not files (an in-app row, a mounted folder) dropped here; return true when it was taken. */
  onOther?: (dt: TransferLike) => boolean;
}

export interface FileDrop {
  /** A drag with files is over the zone. */
  over: boolean;
  /** The event props for the zone's element (a real element, never a View). Empty off the web. */
  bind: Record<string, unknown>;
}

/**
 * Drop and paste for one zone. Enter and leave are counted, so moving over the fields and buttons inside does not flicker the zone. A zone inside another keeps its
 * events: the outer one never lights up under it, and a drop goes to the innermost zone only.
 */
export function useFileDrop(onFiles: (files: DroppedFile[], how: "drop" | "paste") => void, opts: FileDropOptions = {}): FileDrop {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const cb = useRef({ onFiles, opts });
  cb.current = { onFiles, opts };
  const drop = opts.drop !== false;
  const paste = opts.paste !== false;
  const bind = useMemo<Record<string, unknown>>(() => {
    if (Platform.OS !== "web") return {};
    const out: Record<string, unknown> = {};
    const on = (): boolean => cb.current.opts.enabled !== false;
    const other = (e: DragEventLike): boolean => !carriesFiles(e.dataTransfer) && cb.current.opts.onOther !== undefined;
    if (drop) {
      out["onDragEnter"] = (e: DragEventLike) => {
        if (!carriesFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation?.();
        depth.current += 1;
        if (on()) setOver(true);
      };
      out["onDragOver"] = (e: DragEventLike) => {
        if (other(e)) { if (list(e.dataTransfer?.types).includes("text/plain")) e.preventDefault(); return; }
        if (!carriesFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation?.();
        if (e.dataTransfer) e.dataTransfer.dropEffect = on() ? "copy" : "none";
      };
      out["onDragLeave"] = (e: DragEventLike) => {
        if (!carriesFiles(e.dataTransfer)) return;
        e.stopPropagation?.();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      };
      out["onDrop"] = (e: DragEventLike) => {
        if (other(e)) { if (cb.current.opts.onOther?.(e.dataTransfer as TransferLike)) e.preventDefault(); return; }
        if (!carriesFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation?.();
        depth.current = 0;
        setOver(false);
        const files = filesIn(e.dataTransfer);
        if (on() && files.length > 0) cb.current.onFiles(files, "drop");
      };
    }
    if (paste) {
      out["onPaste"] = (e: PasteEventLike) => {
        if (!on()) return;
        const files = pastedFiles(e.clipboardData);
        if (files.length === 0) return;
        e.preventDefault();
        e.stopPropagation?.();
        const at = new Date();
        cb.current.onFiles(files.map((f) => (f.name && f.name !== "image.png" ? f : renamed(f, pastedName(f, at)))), "paste");
      };
    }
    return out;
  }, [drop, paste]);
  return { over: over && opts.enabled !== false, bind };
}

/** The same file under another name, its bytes and type kept (a pasted screenshot is called image.png by the engine). */
function renamed(f: DroppedFile, name: string): DroppedFile {
  const File_ = (globalThis as { File?: new (parts: unknown[], name: string, o: { type?: string }) => DroppedFile }).File;
  if (File_) { try { return new File_([f], name, f.type ? { type: f.type } : {}); } catch { /* a stand-in file in a test */ } }
  return { name, ...(f.size === undefined ? {} : { size: f.size }), ...(f.type === undefined ? {} : { type: f.type }), ...(f.arrayBuffer ? { arrayBuffer: () => f.arrayBuffer!() } : {}) };
}

/** The soft layer over a zone while files are dragged over it: one line, no motion. It takes no events, so the drag underneath is not disturbed. */
export function DropOverlay({ label = DROP_LINE, radius = 10, testID = "drop-overlay" }: { label?: string; radius?: number; testID?: string }): ReactElement {
  return (
    <View pointerEvents="none" testID={testID} accessibilityLiveRegion="polite" style={[s.overlay, { borderRadius: radius }]}>
      <Text style={s.line}>{label}</Text>
    </View>
  );
}

const CONTENTS = { display: "contents" } as const;

/** An element with no box of its own that takes drop and paste events for what is inside it: for something that already draws its own box (the composer). */
export function DropHost({ bind, children, testID }: { bind: Record<string, unknown>; children: ReactNode; testID?: string }): ReactElement {
  if (Platform.OS !== "web") return <>{children}</>;
  return createElement("div", { ...bind, style: CONTENTS, ...(testID ? { "data-testid": testID } : {}) }, children);
}

const BOX = { display: "flex", flexDirection: "column", position: "relative", minWidth: 0, minHeight: 0, boxSizing: "border-box" } as const;

export interface DropZoneProps extends FileDropOptions {
  onFiles(files: DroppedFile[], how: "drop" | "paste"): void;
  children?: ReactNode;
  label?: string;
  /** Plain CSS for the zone's box (flex, size). */
  style?: Record<string, unknown>;
  radius?: number;
  testID?: string;
}

/** A box that takes dropped and pasted files, with the soft layer while files are over it. Off the web it is a plain View. */
export function DropZone({ onFiles, children, label, style, radius, testID = "drop-zone", ...opts }: DropZoneProps): ReactElement {
  const { over, bind } = useFileDrop(onFiles, opts);
  if (Platform.OS !== "web") return <View style={style as object} testID={testID}>{children}</View>;
  return createElement("div", { ...bind, "data-testid": testID, ...(over ? { "data-drop-over": "1" } : {}), style: { ...BOX, ...style } }, children, over ? <DropOverlay key="drop-overlay" {...(label ? { label } : {})} {...(radius === undefined ? {} : { radius })} /> : null);
}

/** Files a field holds until it is sent (quick add): each name, with a button that takes it off. */
export function HeldFiles({ files, onRemove, testID = "held-files" }: { files: readonly { name: string }[]; onRemove(index: number): void; testID?: string }): ReactElement | null {
  if (files.length === 0) return null;
  return (
    <View style={s.held} testID={testID}>
      {/* ui-rows-lint: not a list (the names of files held by a field, beside it) */}
      {files.map((f, i) => (
        <View key={`${i}:${f.name}`} style={s.chip} testID={`${testID}-${i}`}>
          <Text numberOfLines={1} style={s.chipText}>{f.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${f.name}`} testID={`${testID}-remove-${i}`} onPress={() => onRemove(i)} style={s.chipX}>
            <Text style={s.chipXText}>{"\u00d7"}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

/* ---------- a pane that hands its drops to the composer inside it ---------- */

type Take = (files: DroppedFile[], how: "drop" | "paste") => void;
interface Route { set(take: Take | null): void }
const RouteContext = createContext<Route | null>(null);

/**
 * A pane (a chat, a task's comments, an Ask pane) whose whole area takes files for the composer inside it: a drop anywhere on the pane goes to that composer's tray.
 * With no composer inside (a closed thread) a drop does nothing.
 */
export function DropRoute({ children, style, testID = "drop-route", label, onOther }: { children?: ReactNode; style?: Record<string, unknown>; testID?: string; label?: string; onOther?: (dt: TransferLike) => boolean }): ReactElement {
  const take = useRef<Take | null>(null);
  const [has, setHas] = useState(false);
  const route = useMemo<Route>(() => ({ set: (t) => { take.current = t; setHas(t !== null); } }), []);
  const onFiles = useCallback<Take>((files, how) => { take.current?.(files, how); }, []);
  return (
    <RouteContext.Provider value={route}>
      <DropZone onFiles={onFiles} enabled={has} paste={false} testID={testID} {...(style ? { style } : {})} {...(label ? { label } : {})} {...(onOther ? { onOther } : {})}>{children}</DropZone>
    </RouteContext.Provider>
  );
}

/** For the composer: inside a DropRoute it takes the pane's drops and returns true (the pane draws the layer); outside one it returns false and makes its own zone. */
export function useDropRoute(take: Take | null): boolean {
  const route = useContext(RouteContext);
  const ref = useRef(take);
  ref.current = take;
  const on = take !== null;
  useEffect(() => {
    if (!route || !on) return undefined;
    route.set((files, how) => ref.current?.(files, how));
    return () => route.set(null);
  }, [route, on]);
  return route !== null;
}

/* ---------- the page guard ---------- */

interface WinLike { addEventListener(type: string, fn: (e: DragEventLike & { defaultPrevented?: boolean }) => void): void; removeEventListener(type: string, fn: (e: DragEventLike & { defaultPrevented?: boolean }) => void): void }

/**
 * Files dropped where no zone takes them do nothing: without this the page (and the Mac app's web view) opens the file in place of Vyre. A zone has already taken its own
 * drop and stopped it, so this only sees drops elsewhere. Text and in-app drags pass through untouched. Returns the function that removes the guard.
 */
export function guardFileDrops(win: WinLike | undefined = (globalThis as { window?: WinLike }).window): () => void {
  if (!win || typeof win.addEventListener !== "function") return () => undefined;
  const over = (e: DragEventLike & { defaultPrevented?: boolean }): void => {
    if (!carriesFiles(e.dataTransfer) || e.defaultPrevented) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
  };
  const drop = (e: DragEventLike & { defaultPrevented?: boolean }): void => {
    if (carriesFiles(e.dataTransfer)) e.preventDefault();
  };
  win.addEventListener("dragover", over);
  win.addEventListener("drop", drop);
  return () => { win.removeEventListener("dragover", over); win.removeEventListener("drop", drop); };
}

const s = StyleSheet.create({
  overlay: {
    position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: "var(--accent-wash)" as string, borderWidth: 1.5, borderStyle: "dashed", borderColor: "var(--accent)" as string,
  },
  line: { fontSize: 13, fontWeight: "600", color: "var(--accent)" as string },
  held: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, minWidth: 0 },
  chip: { flexDirection: "row", alignItems: "center", maxWidth: 200, height: 24, paddingLeft: 9, paddingRight: 3, borderRadius: 12, backgroundColor: "var(--hover)" as string },
  chipText: { flexShrink: 1, fontSize: 12.5, color: "var(--ink-2)" as string },
  chipX: { width: 18, height: 18, alignItems: "center", justifyContent: "center", borderRadius: 9 },
  chipXText: { fontSize: 13, lineHeight: 14, color: "var(--ink-3)" as string },
});
