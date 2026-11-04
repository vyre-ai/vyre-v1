// An uploaded face is a file in the agent's folder (face.webp, replaced by a new one on each change); the agent's `face` names it as av1:file:<fileId>.
import { parseFace } from "../../../../../../ui/src/Avatar/agentface.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;

/** The bytes of a data URL and their type, or null when it is not a picture we keep. */
export function pictureOf(dataUrl: string): { base64: string; mime: string } | null {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  return m ? { mime: m[1]!, base64: m[2]! } : null;
}

/** Writes the picture into the folder and answers the face text that names it, or null when it could not be kept. */
export async function saveFaceFile(call: Call, folderId: string, dataUrl: string, key: () => string): Promise<string | null> {
  const pic = pictureOf(dataUrl);
  if (pic === null || folderId === "") return null;
  const out = (await call("files.create", { folderId, name: `face-${key().slice(-8)}.${pic.mime.slice(6) === "jpeg" ? "jpg" : pic.mime.slice(6)}`, content: { base64: pic.base64 }, mime: pic.mime, idempotencyKey: key() })) as { file?: { fileId?: string } };
  const id = out.file?.fileId;
  const face = id ? `av1:file:${id}` : null;
  return face !== null && parseFace(face) !== null ? face : null;
}
