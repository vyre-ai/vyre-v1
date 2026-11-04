// The pictures behind av1:file:<fileId> faces: uploaded to the agent's folder, read once through the shell's loader (files.read) and kept for the session, so a list of faces asks for each picture once.
// The shell registers the loader as it opens a Space; without one the face draws as its tint until a picture arrives.

type Loader = (fileId: string) => Promise<string>;
let loader: Loader | null = null;
const pictures = new Map<string, string>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
const emit = (): void => { for (const l of [...listeners]) l(); };

/** The shell says how to read a picture: a file id to a data URL. */
export function setFaceImageLoader(next: Loader | null): void {
  loader = next;
  asked.clear();
  emit();
}

/** The picture, once it has arrived. */
export const faceImageOf = (fileId: string): string | undefined => pictures.get(fileId);

/** A picture the caller already holds (just uploaded): shown at once, no read. */
export function primeFaceImage(fileId: string, dataUrl: string): void {
  pictures.set(fileId, dataUrl);
  emit();
}

/** Asks for a picture once; every face of it shares the answer. */
export function requestFaceImage(fileId: string): void {
  if (loader === null || pictures.has(fileId) || asked.has(fileId)) return;
  asked.add(fileId);
  void loader(fileId).then((url) => { if (/^data:image\/(png|jpeg|webp);base64,/.test(url)) { pictures.set(fileId, url); emit(); } }, () => { asked.delete(fileId); });
}

export function subscribeFaceImages(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
/** Test seam. */
export function resetFaceImages(): void { pictures.clear(); asked.clear(); loader = null; emit(); }
