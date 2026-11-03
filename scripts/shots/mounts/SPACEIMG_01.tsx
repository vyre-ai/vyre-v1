// Mount for the Space image (lane l-agenttoml, rc.16), over scripted answers. ?part=
//   profile-empty (Console > Space profile: no image yet, the letter, Choose image… and Choose from Files…), crop (a wide logo pasted in: the square crop, zoom, and the preview on the rail,
//   sign-in and switcher), from-files (Choose from Files…: every picture in the Space's folders, newest first, with a search), profile-saved (the image saved: it shows in the row),
//   rail (the rail tile and the open switcher, with the image), signin (the sign-in page of a Space with an image), join (an invite's join page with the image)
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import type { ConsoleData } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole } from "../../../apps/app/src/console/shell/sample.ts";
import { SpaceProfile } from "../../../apps/app/src/console/pages/InfrastructureSettings.tsx";
import { SpaceTile } from "../../../apps/app/src/shell/spaces/SpaceSwitcher.tsx";
import { HARBOR, NORTHWIND, PERSONAL } from "../../../apps/app/src/shell/spaces/model.ts";
import { signInInvite } from "../../../apps/app/src/shell/session/SessionGate.tsx";
import { JoinFlow } from "../../../apps/app/src/join/JoinFlow.tsx";
import { SpaceImageContext } from "../../../apps/app/src/join/kit.tsx";
import type { JoinInvite } from "../../../apps/app/src/join/logic.ts";

export const title = "The Space image: upload, crop, and where it shows";

const NOW = Date.UTC(2026, 10, 3, 4, 20, 0);
const noop = (): void => undefined;

/** A logo drawn here, so the mount needs no picture file: a wide one (to crop) or the square the crop saves. */
function logo(w: number, h: number): string {
  const doc = (globalThis as { document?: Document }).document;
  const c = doc?.createElement("canvas");
  const g = c?.getContext("2d");
  if (!c || !g) return "";
  c.width = w; c.height = h;
  g.fillStyle = "#F4EFE6"; g.fillRect(0, 0, w, h);
  const side = Math.min(w, h) * 0.82, x = (w - side) / 2, y = (h - side) / 2;
  g.fillStyle = "#12305A";
  g.beginPath(); g.roundRect(x, y, side, side, side * 0.18); g.fill();
  g.strokeStyle = "#C9A24A"; g.lineWidth = side * 0.035;
  g.beginPath(); g.moveTo(x + side * 0.5, y + side * 0.2); g.lineTo(x + side * 0.5, y + side * 0.5); g.moveTo(x + side * 0.28, y + side * 0.3); g.lineTo(x + side * 0.72, y + side * 0.3); g.stroke();
  g.beginPath(); g.arc(x + side * 0.28, y + side * 0.38, side * 0.08, 0, Math.PI); g.arc(x + side * 0.72, y + side * 0.38, side * 0.08, 0, Math.PI); g.stroke();
  g.fillStyle = "#F4EFE6"; g.font = `700 ${Math.round(side * 0.2)}px Georgia, serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("MLA", x + side / 2, y + side * 0.72);
  if (w > h) { g.fillStyle = "#12305A"; g.font = `600 ${Math.round(h * 0.06)}px Georgia, serif`; g.textAlign = "left"; g.fillText("My Legal Academy", x + side + h * 0.24, h / 2); }
  return c.toDataURL("image/png");
}

const SPACE = { id: "spc_mla", name: "My Legal Academy", kind: "team", owner: "usr_irfad", fingerprint: "ab12 cd34 ef56 7890", address: { mode: "own_domain", host: "mla.vyre.run" }, defaults: {}, createdAt: NOW - 40 * 86_400_000 };

const FILES = [
  { name: "MLA logo.png", ago: 0.2 }, { name: "Lab 7 cover.png", ago: 1 }, { name: "Andrey headshot.jpg", ago: 3 }, { name: "Probate webinar banner.png", ago: 6 }, { name: "Office front.jpg", ago: 12 }, { name: "Brand colours.png", ago: 30 },
].map((f, i) => ({ fileId: `fil_${String(i + 1).padStart(32, "0")}`, folderId: "fld_brand", name: f.name, kind: "image", mime: f.name.endsWith(".jpg") ? "image/jpeg" : "image/png", size: 48_000, version: 1, label: 0, ownerId: "usr_irfad", createdAt: NOW - f.ago * 86_400_000, updatedAt: NOW - f.ago * 86_400_000, updatedBy: "usr_irfad", thumb: true, holds: 0 }));

function consoleFor(o: { image?: string; wide: string; square: string }): ConsoleData {
  const base = createSampleConsole().data;
  const space = { ...SPACE, ...(o.image ? { logoFileId: "fil_saved000000000000000000000000000" } : {}) };
  const rows: Record<string, unknown> = { "spaces.get": { space } };
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = (input ?? {}) as Record<string, unknown>;
    if (cap === "spaces.image") return o.image ? { logoFileId: "fil_saved000000000000000000000000000", image: o.image } : {};
    if (cap === "spaces.get") return { space };
    if (cap === "files.list") { const q = String(i["q"] ?? "").toLowerCase(); const files = FILES.filter((f) => f.name.toLowerCase().includes(q)); return { files, folders: [], total: files.length }; }
    if (cap === "files.read") return { base64: o.wide.split(",")[1], mime: "image/png", size: 60_000, version: 1, truncated: false };
    if (cap === "files.resolve") return { kind: "folder", folderId: "fld_brand" };
    if (cap === "files.create") return { file: { ...FILES[0], fileId: "fil_new00000000000000000000000000000" } };
    if (cap === "spaces.update") return { space };
    return {};
  };
  return { ...base, call, screens: { ...base.screens, capQuery: (cap: string) => { const state = rows[cap] === undefined ? { status: "loading" } : { status: "ready", data: rows[cap] }; return { subscribe: () => () => undefined, getSnapshot: () => state }; } } as never };
}

/** Paste a picture into the page, the way Cmd-V of a copied logo does. */
function paste(url: string, name: string): void {
  const doc = (globalThis as { document?: Document }).document;
  const DT = (globalThis as { DataTransfer?: typeof DataTransfer }).DataTransfer;
  if (!doc || !DT) return;
  const bytes = Uint8Array.from(atob(url.split(",")[1] ?? ""), (ch) => ch.charCodeAt(0));
  const dt = new DT();
  dt.items.add(new File([bytes], name, { type: "image/png" }));
  doc.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
}

const click = (testId: string): void => { (globalThis as { document?: Document }).document?.querySelector<HTMLElement>(`[data-testid='${testId}']`)?.click(); };

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "profile-empty"), []);
  const wide = useMemo(() => logo(960, 540), []);
  const square = useMemo(() => logo(256, 256), []);
  const empty = useMemo(() => consoleFor({ wide, square }), [wide, square]);
  const saved = useMemo(() => consoleFor({ image: square, wide, square }), [wide, square]);
  useEffect(() => {
    if (part === "crop") { const t = setTimeout(() => paste(wide, "MLA logo.png"), 300); return () => clearTimeout(t); }
    if (part === "from-files") { const t = setTimeout(() => click("space-image-from-files"), 300); return () => clearTimeout(t); }
    if (part === "rail") { const t = setTimeout(() => click("space-tile"), 300); return () => clearTimeout(t); }
    return undefined;
  }, [part, wide]);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (part === "profile-empty" || part === "crop" || part === "from-files" || part === "profile-saved") {
    return <ConsoleDataProvider value={part === "profile-saved" ? saved : empty}><View style={{ flex: 1, minHeight: 860, padding: 24, maxWidth: 980 }}><SpaceProfile /></View></ConsoleDataProvider>;
  }
  if (part === "rail") {
    const mla = { ...NORTHWIND, spaceId: "mla", name: "My Legal Academy", address: "mla.vyre.run", image: square, imageKey: "fil_saved" };
    return (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
        <View style={{ width: 64, alignItems: "center", paddingTop: 14, backgroundColor: "var(--rail)" as string }}>
          <SpaceTile spaces={[mla, HARBOR, PERSONAL]} openId="mla" away={false} onSwitch={noop} onAction={noop} />
        </View>
      </View>
    );
  }
  if (part === "signin") {
    const invite = signInInvite("https://mla.vyre.run", { name: "My Legal Academy", fingerprint: "", password: true, github: false, sso: [], secondFactorRequired: false });
    return <SpaceImageContext.Provider value={square}><JoinFlow invite={invite} initial={{ stage: "signin" }} /></SpaceImageContext.Provider>;
  }
  const invite: JoinInvite = { space: "My Legal Academy", host: "mla.vyre.run", by: "Irfad Imtiaz", role: "Member", fingerprint: "ab12 cd34 ef56 7890", sso: [], github: false, adminKey: false, deviceName: "Chrome on Mac" };
  return <SpaceImageContext.Provider value={square}><JoinFlow invite={invite} /></SpaceImageContext.Provider>;
}
