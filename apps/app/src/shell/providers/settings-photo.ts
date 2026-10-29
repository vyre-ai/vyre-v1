// Settings > Profile > Photo > Choose: the person picks an image, it is kept as a file in their own (personal) Files, and the file id is what the profile photo setting holds. A photo is small, so it
// goes in one files.create as base64; a larger picture is refused with a line that says so, never cut. The picker is the page's own file chooser; where there is no page (a native shell without one) nothing
// is chosen.
import { attemptKey } from "./files-review.ts";
import type { ShellRuntime } from "./runtime.tsx";

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export interface PickedImage { name: string; mime: string; size: number; base64: string }
export type PickImage = () => Promise<PickedImage | null>;

type Doc = { createElement(tag: "input"): { type: string; accept: string; onchange: (() => void) | null; oncancel: (() => void) | null; files?: ArrayLike<{ name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }>; click(): void } };

/** The page's file chooser for one image; null when it is cancelled or the page has none. */
export const pickImageFromPage: PickImage = () => {
  const doc = (globalThis as { document?: Doc }).document;
  if (!doc) return Promise.resolve(null);
  return new Promise((resolve) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.oncancel = () => resolve(null);
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) { resolve(null); return; }
      void f.arrayBuffer().then((buf) => {
        let bin = "";
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        resolve({ name: f.name, mime: f.type || "image/png", size: f.size, base64: btoa(bin) });
      }, () => resolve(null));
    };
    input.click();
  });
};

/** The id of the file the chosen image was saved as, or null when nothing was chosen. Throws a sentence the page can show when the image is too big or there is no personal folder to keep it in. */
export async function chooseProfilePhoto(rt: Pick<ShellRuntime, "call">, pick: PickImage = pickImageFromPage): Promise<string | null> {
  const img = await pick();
  if (!img) return null;
  if (img.size > PHOTO_MAX_BYTES) throw new Error("Choose a photo under 2 MB.");
  const list = (await rt.call("files.list", {})) as { folders: Array<{ folderId: string; scope: string; parentId?: string | null }> };
  const home = list.folders.find((f) => f.scope === "personal" && !f.parentId);
  if (!home) throw new Error("There is no personal folder to keep the photo in.");
  const made = (await rt.call("files.create", { folderId: home.folderId, name: img.name, mime: img.mime, content: { base64: img.base64 }, idempotencyKey: attemptKey() })) as { file: { fileId: string } };
  return made.file.fileId;
}
