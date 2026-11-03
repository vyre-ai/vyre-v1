// The Space image, from a picture to the Space's face (Console > Space profile). A picture comes from the file picker, a drop, a paste or a Space file; Console crops it to a square, shrinks it to
// IMAGE_SIDE pixels, uploads it to Shared knowledge/Branding and saves it as the Space image (spaces.update logoFileId). The Space keeps a copy for the faces people see before they sign in.
// What can be tested without a window is here: the crop square, the name, which files are pictures, and the save.

/** The side of the saved square, in pixels: sharp on the 36 px rail tile and the 40 px join tile at 3x, and small enough for the sign-in page to carry. */
export const IMAGE_SIDE = 256;
/** What the Space takes (modules/spaces IMAGE_MAX_BYTES); a saved square that is larger is sent as a JPEG instead. */
export const IMAGE_MAX_BYTES = 256 * 1024;
/** Where an uploaded Space image goes: the system folder for the Space's own pictures. */
export const BRANDING_PATH = "Shared knowledge/Branding";
/** The most a picture may be to open in the cropper. */
export const SOURCE_MAX_BYTES = 20 * 1024 * 1024;

const PICTURE = /^image\/(png|jpe?g|webp|gif)$/i;
const PICTURE_NAME = /\.(png|jpe?g|webp|gif)$/i;

/** A picture the cropper opens: PNG, JPEG, WebP or GIF, by type or, when the browser gives none, by name. SVG is not one: it can carry script. */
export function isPicture(f: { name?: string; type?: string; size?: number }): boolean {
  if (f.size !== undefined && f.size > SOURCE_MAX_BYTES) return false;
  if (f.type) return PICTURE.test(f.type);
  return PICTURE_NAME.test(f.name ?? "");
}

/** The words for a file that is not a picture the Space can use. */
export function notPictureLine(f: { name?: string; type?: string; size?: number }): string {
  if (f.size !== undefined && f.size > SOURCE_MAX_BYTES) return `${f.name ?? "That file"} is over ${SOURCE_MAX_BYTES / 1024 / 1024} MB. Choose a smaller picture.`;
  return `${f.name ?? "That file"} is not a PNG, JPEG, WebP or GIF picture.`;
}

export interface Crop { zoom: number; x: number; y: number }
export const FULL: Crop = { zoom: 1, x: 0, y: 0 };
export const MAX_ZOOM = 4;

/**
 * The square of the picture that is kept, in the picture's own pixels. At zoom 1 it is the largest square (the short side), centred; zooming in makes it smaller; x and y move its centre (in picture
 * pixels) and are held so the square never leaves the picture.
 */
export function cropSquare(natural: { w: number; h: number }, crop: Crop): { sx: number; sy: number; side: number } {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom));
  const side = Math.min(natural.w, natural.h) / zoom;
  const cx = natural.w / 2 + crop.x, cy = natural.h / 2 + crop.y;
  const sx = Math.min(natural.w - side, Math.max(0, cx - side / 2));
  const sy = Math.min(natural.h - side, Math.max(0, cy - side / 2));
  return { sx, sy, side };
}

/** The crop after a drag of (dx, dy) screen pixels in a viewport `view` pixels wide: the picture moves with the pointer, held inside. */
export function dragged(natural: { w: number; h: number }, crop: Crop, dx: number, dy: number, view: number): Crop {
  const { side } = cropSquare(natural, crop);
  const perPixel = side / view;
  const next = { ...crop, x: crop.x - dx * perPixel, y: crop.y - dy * perPixel };
  // keep the stored centre where the square really is, so a drag back starts moving at once
  const held = cropSquare(natural, next);
  return { zoom: next.zoom, x: held.sx + held.side / 2 - natural.w / 2, y: held.sy + held.side / 2 - natural.h / 2 };
}

/** "Space image 2026-11-03 at 04.20.15.png": the name of the uploaded square, readable in Files. */
export function imageName(at: Date, ext: "png" | "jpg" = "png"): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `Space image ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} at ${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}.${ext}`;
}

/** The bytes a base64 text holds. */
export const base64Bytes = (b64: string): number => Math.floor((b64.replace(/=+$/, "").length * 3) / 4);

/** A data: address split into its type and base64 body; null for anything else. */
export function splitDataUrl(url: string): { mime: string; base64: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return m ? { mime: m[1]!.toLowerCase(), base64: m[2]! } : null;
}

export type Call = (cap: string, input: unknown) => Promise<unknown>;

/**
 * Upload the square to Shared knowledge/Branding and make it the Space image: files.resolve finds the folder (Files makes it with the Space's other system folders), files.create puts the picture
 * there as the person, and spaces.update makes it the Space image. Answers the new file's id.
 */
export async function saveSpaceImage(call: Call, square: { mime: string; base64: string }, at: Date, key: string): Promise<string> {
  const folder = (await call("files.resolve", { path: BRANDING_PATH })) as { kind?: string; folderId?: string };
  if (folder.kind !== "folder" || typeof folder.folderId !== "string") throw new Error("The Branding folder is missing. Open Files once and try again.");
  const ext = square.mime === "image/jpeg" ? "jpg" : "png";
  const made = (await call("files.create", { folderId: folder.folderId, name: imageName(at, ext), content: { base64: square.base64 }, mime: square.mime, idempotencyKey: `space-image:${key}` })) as { file?: { fileId?: string } };
  const fileId = made.file?.fileId;
  if (typeof fileId !== "string") throw new Error("The picture did not upload. Try again.");
  await call("spaces.update", { logoFileId: fileId });
  return fileId;
}
