// Console > Space profile > Space image, the way any app sets a picture: Choose image… opens the file picker; a picture dropped on the section or pasted (Cmd-V) opens too. The picture opens in a
// square crop with a zoom and a drag, beside how it will look on the rail and on the sign-in page; Save image uploads the square to Shared knowledge/Branding and makes it the Space image.
// Choose from Files… is the second way in: every picture in the Space's folders the person can see, newest first, with a search; the one chosen opens in the same crop.
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Image, Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { DropZone, pastedFiles } from "../../../../../ui/src/FileDrop/index.tsx";
import type { DroppedFile } from "../../../../../ui/src/FileDrop/index.tsx";
import { Empty, Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Actions, Button, Field, Help, Note, ReadState, attempt, useRead } from "./shared.tsx";
import { FULL, IMAGE_MAX_BYTES, IMAGE_SIDE, MAX_ZOOM, base64Bytes, cropSquare, dragged, isPicture, notPictureLine, saveSpaceImage, splitDataUrl } from "./space-image.ts";
import type { Crop } from "./space-image.ts";

const web = Platform.OS === "web";
const VIEW = 220;

interface Source { url: string; name: string }
interface Loaded { img: HTMLImageElement; w: number; h: number }

/** A browser file as a data: address. */
function readFile(f: DroppedFile): Promise<string> {
  return new Promise((resolve, reject) => {
    const Reader = (globalThis as { FileReader?: typeof FileReader }).FileReader;
    if (!Reader) { reject(new Error("This window cannot read files.")); return; }
    const r = new Reader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("That picture could not be read."));
    r.readAsDataURL(f as unknown as Blob);
  });
}

/** The kept square drawn at IMAGE_SIDE pixels: a PNG, or a JPEG when the PNG would be over what the Space takes. */
function squareOf(loaded: Loaded, crop: Crop): { mime: string; base64: string; url: string } | null {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return null;
  const canvas = doc.createElement("canvas");
  canvas.width = IMAGE_SIDE; canvas.height = IMAGE_SIDE;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const { sx, sy, side } = cropSquare({ w: loaded.w, h: loaded.h }, crop);
  g.imageSmoothingQuality = "high";
  g.drawImage(loaded.img, sx, sy, side, side, 0, 0, IMAGE_SIDE, IMAGE_SIDE);
  let url = canvas.toDataURL("image/png");
  let parts = splitDataUrl(url);
  if (parts && base64Bytes(parts.base64) > IMAGE_MAX_BYTES * 0.95) { url = canvas.toDataURL("image/jpeg", 0.88); parts = splitDataUrl(url); }
  return parts ? { ...parts, url } : null;
}

/** The square crop: the picture fills a square viewport; drag moves it, the slider zooms. */
function Cropper({ loaded, crop, onCrop }: { loaded: Loaded; crop: Crop; onCrop(c: Crop): void }): ReactElement {
  const drag = useRef<{ x: number; y: number; from: Crop } | null>(null);
  const { sx, sy, side } = cropSquare({ w: loaded.w, h: loaded.h }, crop);
  const scale = VIEW / side;
  const img = createElement("img", {
    src: loaded.img.src, alt: "", draggable: false, "data-testid": "space-image-crop-picture",
    style: { position: "absolute", left: -sx * scale, top: -sy * scale, width: loaded.w * scale, height: loaded.h * scale, maxWidth: "none", userSelect: "none", pointerEvents: "none" },
  });
  const box = createElement("div", {
    "data-testid": "space-image-crop", role: "img", "aria-label": "Crop: drag to move the picture",
    style: { position: "relative", width: VIEW, height: VIEW, overflow: "hidden", borderRadius: 16, cursor: "grab", touchAction: "none", background: "var(--hover)", boxShadow: "inset 0 0 0 1px var(--line)" },
    onPointerDown: (e: { clientX: number; clientY: number; currentTarget: { setPointerCapture?(id: number): void }; pointerId: number }) => { drag.current = { x: e.clientX, y: e.clientY, from: crop }; e.currentTarget.setPointerCapture?.(e.pointerId); },
    onPointerMove: (e: { clientX: number; clientY: number }) => { const d = drag.current; if (d) onCrop(dragged({ w: loaded.w, h: loaded.h }, d.from, e.clientX - d.x, e.clientY - d.y, VIEW)); },
    onPointerUp: () => { drag.current = null; },
    onPointerCancel: () => { drag.current = null; },
  }, img);
  const zoom = createElement("input", {
    type: "range", min: 1, max: MAX_ZOOM, step: 0.01, value: crop.zoom, "aria-label": "Zoom", "data-testid": "space-image-zoom",
    onChange: (e: { target: { value: string } }) => onCrop({ ...crop, zoom: Number(e.target.value) }),
    style: { width: VIEW, accentColor: "var(--accent)" },
  });
  return <View style={s.cropCol}>{box}<View style={s.zoomRow}><Text style={s.small}>Zoom</Text>{zoom}</View></View>;
}

/** How the square will look where the Space shows its face. */
function Faces({ url, name }: { url: string; name: string }): ReactElement {
  return (
    <View style={s.faces} testID="space-image-preview">
      <View style={s.face}><Image source={{ uri: url }} style={[s.faceImg, { width: 36, height: 36, borderRadius: 13 }]} accessibilityLabel={`${name} on the rail`} /><Text style={s.small}>Rail</Text></View>
      <View style={s.face}><Image source={{ uri: url }} style={[s.faceImg, { width: 40, height: 40, borderRadius: 12 }]} accessibilityLabel={`${name} on the sign-in page`} /><Text style={s.small}>Sign-in</Text></View>
      <View style={s.face}><Image source={{ uri: url }} style={[s.faceImg, { width: 18, height: 18, borderRadius: 5 }]} accessibilityLabel={`${name} in the switcher`} /><Text style={s.small}>Switcher</Text></View>
    </View>
  );
}

/** Choose from Files: every picture in the Space's folders the person can see, newest first, with a search. */
function FilesPicker({ onChoose, onClose }: { onChoose(file: { fileId: string; name: string }): void; onClose(): void }): ReactElement {
  const [q, setQ] = useState("");
  const files = useRead<CapMap["files.list"]["out"]>("files.list", { section: "space", deep: true, kind: "image", sort: "updated", dir: "desc", limit: 60, ...(q.trim() ? { q: q.trim() } : {}) }, { direct: true });
  const list = files.data?.files ?? null;
  return (
    <Section title="Choose a Space image from Files" testID="space-image-files">
      <Group>
        <Field label="Search pictures" value={q} onChange={setQ} testID="space-image-files-search" />
        {list === null ? <ReadState error={files.error} retry={files.refresh} />
          : list.length === 0 ? <Empty icon="doc">{q.trim() ? `No pictures named like “${q.trim()}”` : "No pictures in this Space’s folders yet. Choose image… uploads one."}</Empty>
          : list.map((f) => <Row key={f.fileId} id={`space-image-file-${f.fileId}`} title={f.name} note={new Date(f.updatedAt).toLocaleDateString()} onPress={() => onChoose(f)} trailing={<Button label="Use" onPress={() => onChoose(f)} />} />)}
        <Actions><Button label="Close" onPress={onClose} /></Actions>
      </Group>
    </Section>
  );
}

export function SpaceImage({ spaceName, logoFileId, onSaved }: { spaceName: string; logoFileId: string | null; onSaved(): void }): ReactElement {
  const { call } = useConsoleData();
  const winW = useWindowDimensions().width;
  const narrow = winW > 0 && winW < 720;
  const current = useRead<CapMap["spaces.image"]["out"]>("spaces.image", {}, { direct: true });
  const [source, setSource] = useState<Source | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [crop, setCrop] = useState<Crop>(FULL);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [fromFiles, setFromFiles] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const key = useRef(attempt());

  useEffect(() => { current.refresh(); }, [logoFileId]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = useCallback(async (files: readonly DroppedFile[]): Promise<void> => {
    const f = files.find(isPicture);
    if (!f) { setNote(files[0] ? notPictureLine(files[0]) : ""); return; }
    try { setNote(""); setSource({ url: await readFile(f), name: f.name }); } catch (e) { setNote(e instanceof Error ? e.message : "That picture could not be read."); }
  }, []);

  // a pasted picture opens wherever the focus is on this page, as in any app
  useEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!web || !doc) return undefined;
    const onPaste = (e: ClipboardEvent): void => {
      const files = pastedFiles(e.clipboardData as never);
      if (files.length === 0) return;
      e.preventDefault();
      void open(files);
    };
    doc.addEventListener("paste", onPaste);
    return () => doc.removeEventListener("paste", onPaste);
  }, [open]);

  // the picture, once the browser has it: its size sets up the crop
  useEffect(() => {
    if (!source || !web) { setLoaded(null); return undefined; }
    let alive = true;
    const Img = (globalThis as { Image?: new () => HTMLImageElement }).Image;
    if (!Img) return undefined;
    const img = new Img();
    img.onload = () => { if (alive) { setLoaded({ img, w: img.naturalWidth, h: img.naturalHeight }); setCrop(FULL); } };
    img.onerror = () => { if (alive) { setNote("That picture could not be opened."); setSource(null); } };
    img.src = source.url;
    return () => { alive = false; };
  }, [source]);

  const square = useMemo(() => (loaded ? squareOf(loaded, crop) : null), [loaded, crop]);

  const fromFile = async (file: { fileId: string; name: string }): Promise<void> => {
    setFromFiles(false);
    setNote("");
    try {
      const got = (await call("files.read", { fileId: file.fileId, as: "base64" })) as { base64?: string; mime?: string; truncated?: boolean };
      if (!got.base64 || got.truncated) { setNote(`${file.name} is too large to open here. Download it and use Choose image….`); return; }
      if (!isPicture({ name: file.name, type: got.mime ?? "" })) { setNote(notPictureLine({ name: file.name })); return; }
      setSource({ url: `data:${got.mime};base64,${got.base64}`, name: file.name });
    } catch { setNote(`${file.name} could not be opened.`); }
  };

  const save = async (): Promise<void> => {
    if (!square || busy) return;
    setBusy(true); setNote("");
    try {
      await saveSpaceImage(call, square, new Date(), key.current);
      key.current = attempt();
      setSource(null); setLoaded(null);
      setNote("Space image saved. It shows on the rail, in the switcher, on the sign-in and join pages and in invites.");
      current.refresh(); onSaved();
    } catch (e) {
      const err = e as { message?: string };
      setNote(err.message ?? "The Space image was not saved. Try again.");
    } finally { setBusy(false); }
  };

  const remove = async (): Promise<void> => {
    setBusy(true); setNote("");
    try { await call("spaces.update", { logoFileId: null }); setNote("Space image removed. The Space shows its letter."); current.refresh(); onSaved(); }
    catch (e) { setNote((e as { message?: string }).message ?? "The Space image was not removed. Try again."); }
    finally { setBusy(false); }
  };

  const shown = current.data?.image;
  const picker = web ? createElement("input", {
    ref: input, type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", "data-testid": "space-image-input", style: { display: "none" },
    onChange: (e: { target: { files?: FileList | null; value: string } }) => { const list = e.target.files ? Array.from(e.target.files) as unknown as DroppedFile[] : []; e.target.value = ""; void open(list); },
  }) : null;
  const leading = <View style={s.lead}>{shown
    ? <Image testID="space-image-current" source={{ uri: shown }} accessibilityLabel={spaceName} style={{ width: 36, height: 36, borderRadius: 13 }} />
    : <View testID="space-image-letter" style={s.letter}><Text style={s.letterText}>{(spaceName.trim()[0] ?? "?").toUpperCase()}</Text></View>}</View>;

  return (
    <View testID="space-image">
      <DropZone onFiles={(files) => void open(files)} paste={false} label="Drop a picture to use it as the Space image" testID="space-image-drop" radius={12}>
        <Section title="Space image">
          <Group>
            <Row id="space-logo" title="Space image" note={shown ? "Shows on the rail, the switcher, sign-in, join and invites" : logoFileId ? "Choose it again to show it everywhere" : "No image: the Space shows its letter"} leading={leading}
              {...(narrow ? {} : { trailing: <Actions>
                <Button label="Choose image…" testID="space-image-choose" disabled={busy} onPress={() => input.current?.click()} />
                <Button label="Choose from Files…" testID="space-image-from-files" disabled={busy} onPress={() => setFromFiles(!fromFiles)} />
                {logoFileId ? <Button label="Remove image" testID="space-image-remove" disabled={busy} onPress={() => void remove()} /> : null}
              </Actions> })} />
            {narrow ? <View style={{ paddingHorizontal: 12, paddingBottom: 10 }} testID="space-image-actions"><Actions>
                <Button label="Choose image…" testID="space-image-choose" disabled={busy} onPress={() => input.current?.click()} />
                <Button label="Choose from Files…" testID="space-image-from-files" disabled={busy} onPress={() => setFromFiles(!fromFiles)} />
                {logoFileId ? <Button label="Remove image" testID="space-image-remove" disabled={busy} onPress={() => void remove()} /> : null}
              </Actions></View> : null}
            {picker}
            {source && loaded && square ? (
              <View style={s.editor} testID="space-image-editor">
                <Cropper loaded={loaded} crop={crop} onCrop={setCrop} />
                <View style={s.side}>
                  <Text style={s.label}>Preview</Text>
                  <Faces url={square.url} name={spaceName} />
                  <Text style={s.small}>{source.name} · saved as a {IMAGE_SIDE} × {IMAGE_SIDE} square in Shared knowledge/Branding</Text>
                  <Actions>
                    <Button label={busy ? "Saving…" : "Save image"} testID="space-image-save" disabled={busy} onPress={() => void save()} />
                    <Button label="Cancel" testID="space-image-cancel" disabled={busy} onPress={() => { setSource(null); setLoaded(null); }} />
                  </Actions>
                </View>
              </View>
            ) : <Help>Choose a picture, drop one here or paste it. A square crop works best for a logo.</Help>}
            {note ? <Note>{note}</Note> : null}
          </Group>
        </Section>
      </DropZone>
      {fromFiles ? <FilesPicker onChoose={(f) => void fromFile(f)} onClose={() => setFromFiles(false)} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  editor: { flexDirection: "row", flexWrap: "wrap", gap: 24, paddingVertical: 12, paddingHorizontal: 4, alignItems: "flex-start" },
  cropCol: { gap: 10 },
  zoomRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  side: { gap: 10, minWidth: 220, flexShrink: 1 },
  faces: { flexDirection: "row", alignItems: "flex-end", gap: 18 },
  face: { alignItems: "center", gap: 6 },
  faceImg: { backgroundColor: "var(--hover)" as string },
  label: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  small: { fontSize: 12, color: "var(--ink-3)" as string },
  lead: { marginRight: 12 },
  letter: { width: 36, height: 36, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent)" as string },
  letterText: { color: "var(--accent-ink)" as string, fontSize: 14, fontWeight: "600" },
});
