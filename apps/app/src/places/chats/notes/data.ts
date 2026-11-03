// Notes, the data: one store per Space runtime over the notes capabilities. The page draws what the store holds; a change shows at once and the server's answer replaces it (a refusal
// puts the note back and says so). Images are read with notes.image and kept as data addresses, because the blob route never serves a note's image. No React here.
import type { CapMap } from "../../../../../../generated/types.ts";
import { upsert } from "./model.ts";
import type { Note } from "./model.ts";
import { toDataUri } from "./take.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;

export interface NotesState {
  status: "loading" | "ready" | "failed";
  notes: readonly Note[];
  /** The labels the server named, in its order (the filter lists them with counts). */
  labels: readonly string[];
  /** Counts up when an image arrives, so what draws images draws again. */
  images: number;
}

export type UpdatePatch = Omit<CapMap["notes.update"]["in"], "noteId">;
export type SharePatch = Omit<CapMap["notes.share"]["in"], "noteId">;

export interface NotesStore {
  get(): NotesState;
  subscribe(l: () => void): () => void;
  load(): Promise<void>;
  /** Labels made here before any note carries them (the label menu's Make). */
  addLabel(name: string): void;
  create(input: CapMap["notes.create"]["in"]): Promise<Note | null>;
  update(noteId: string, patch: UpdatePatch, local?: Partial<Note>): Promise<Note | null>;
  pin(noteId: string, pinned: boolean): void;
  label(noteId: string, name: string, on: boolean): void;
  share(noteId: string, patch: SharePatch): Promise<Note | null>;
  remove(noteId: string): Promise<boolean>;
  restore(noteId: string): Promise<Note | null>;
  toTask(input: CapMap["notes.to_task"]["in"]): Promise<{ taskId: string; key?: string } | null>;
  toRecord(input: CapMap["notes.to_record"]["in"]): Promise<{ recordId: string } | null>;
  /** The note's image as a data address, or null until it is read (the store reads it and tells its listeners). */
  image(noteId: string): string | null;
  /** A saved link card's picture (notes.image part link), as a data address; null while it loads or when the card has none. */
  linkImage(noteId: string): string | null;
  /** An image chosen or pasted here: shown at once, before the server has it. */
  setImage(noteId: string, uri: string | null): void;
  /** Where a refusal is said (the page's bar). */
  setSay(say: (text: string) => void): void;
}

const PAGE = 200;
const MAX_PAGES = 10;

export function createNotesStore(call: Call, sayFirst: (text: string) => void = () => undefined, now: () => number = Date.now): NotesStore {
  let say = sayFirst;
  let state: NotesState = { status: "loading", notes: [], labels: [], images: 0 };
  const listeners = new Set<() => void>();
  const images = new Map<string, string | "pending" | "none">();
  const linkImages = new Map<string, string | "pending" | "none">();
  const set = (next: Partial<NotesState>): void => { state = { ...state, ...next }; for (const l of listeners) l(); };
  const ping = (): void => set({ images: state.images + 1 });
  const find = (id: string): Note | undefined => state.notes.find((n) => n.noteId === id);
  const put = (n: Note): void => set({ notes: upsert(state.notes, n) });
  // a change shown before the server answers; on a refusal the note goes back as it was
  const optimistic = async (id: string, local: Partial<Note>, cap: string, input: unknown, failed: string): Promise<Note | null> => {
    const before = find(id);
    if (before) put({ ...before, ...local, updatedAt: now() });
    try {
      const out = (await call(cap, input)) as { note: Note };
      put(out.note);
      return out.note;
    } catch {
      if (before) put(before);
      say(failed);
      return null;
    }
  };

  const store: NotesStore = {
    get: () => state,
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    async load() {
      try {
        const notes: Note[] = [];
        let labels: string[] = [];
        let cursor: string | undefined;
        for (let i = 0; i < MAX_PAGES; i++) {
          const out = (await call("notes.list", { from: "all", limit: PAGE, ...(cursor ? { cursor } : {}) })) as CapMap["notes.list"]["out"];
          notes.push(...out.notes);
          if (i === 0) labels = out.labels.map((l) => l.name);
          if (!out.next) break;
          cursor = out.next;
        }
        const seen = new Set(state.labels);
        set({ status: "ready", notes, labels: [...labels, ...[...seen].filter((l) => !labels.includes(l))] });
      } catch {
        if (state.status === "loading") set({ status: "failed" });
      }
    },
    addLabel(name) { if (!state.labels.includes(name)) set({ labels: [...state.labels, name] }); },
    async create(input) {
      try {
        const out = (await call("notes.create", input)) as CapMap["notes.create"]["out"];
        if (input.image) images.set(out.note.noteId, toDataUri(input.image.contentType, input.image.data));
        for (const l of out.note.labels) store.addLabel(l);
        put(out.note);
        return out.note;
      } catch {
        say("Could not save the note. Try again.");
        return null;
      }
    },
    update(noteId, patch, local = {}) {
      const shown: Partial<Note> = { ...local };
      if (patch.title !== undefined) shown.title = patch.title;
      if (patch.body !== undefined) shown.body = patch.body;
      if (patch.color !== undefined) shown.color = patch.color;
      if (patch.image === null) { shown.hasImage = false; images.set(noteId, "none"); }
      if (patch.image) { shown.hasImage = true; images.set(noteId, toDataUri(patch.image.contentType, patch.image.data)); }
      return optimistic(noteId, shown, "notes.update", { noteId, ...patch }, "Could not save the change. Try again.");
    },
    pin(noteId, pinned) { void optimistic(noteId, { pinned }, "notes.pin", { noteId, pinned }, pinned ? "Could not pin the note." : "Could not unpin the note."); },
    label(noteId, name, on) {
      const n = find(noteId);
      if (!n) return;
      const labels = on ? (n.labels.includes(name) ? n.labels : [...n.labels, name]) : n.labels.filter((l) => l !== name);
      store.addLabel(name);
      void optimistic(noteId, { labels }, "notes.label", { noteId, ...(on ? { add: [name] } : { remove: [name] }) }, "Could not change the labels.");
    },
    share(noteId, patch) {
      const n = find(noteId);
      if (!n) return Promise.resolve(null);
      let people = n.share.people.slice();
      for (const p of patch.people ?? []) {
        people = people.filter((x) => x.personId !== p.personId);
        if (p.role !== "remove") people.push({ personId: p.personId, role: p.role });
      }
      return optimistic(noteId, { share: { people, space: patch.space ?? n.share.space } }, "notes.share", { noteId, ...patch }, "Could not change who sees it.");
    },
    async remove(noteId) {
      const before = find(noteId);
      if (before) set({ notes: state.notes.filter((n) => n.noteId !== noteId) });
      try {
        await call("notes.delete", { noteId });
        return true;
      } catch {
        if (before) put(before);
        say("Could not delete the note.");
        return false;
      }
    },
    async restore(noteId) {
      try {
        const out = (await call("notes.restore", { noteId })) as CapMap["notes.restore"]["out"];
        put(out.note);
        return out.note;
      } catch {
        say("Could not bring the note back.");
        return null;
      }
    },
    async toTask(input) {
      try {
        const out = (await call("notes.to_task", input)) as CapMap["notes.to_task"]["out"];
        if (input.keep === false) set({ notes: state.notes.filter((n) => n.noteId !== input.noteId) }); else put(out.note);
        const key = await Promise.resolve(call("tasks.get", { taskId: out.taskId })).then((t) => (t as CapMap["tasks.get"]["out"]).task.key, () => undefined);
        return { taskId: out.taskId, ...(key ? { key } : {}) };
      } catch {
        say("Could not make the task. Try again.");
        return null;
      }
    },
    async toRecord(input) {
      try {
        const out = (await call("notes.to_record", input)) as CapMap["notes.to_record"]["out"];
        if (input.keep === false) set({ notes: state.notes.filter((n) => n.noteId !== input.noteId) }); else put(out.note);
        return { recordId: out.recordId };
      } catch {
        say("Could not make the record. Check the fields and try again.");
        return null;
      }
    },
    image(noteId) {
      const n = find(noteId);
      const had = images.get(noteId);
      if (had === "pending" || had === "none") return null;
      if (had !== undefined) return had;
      if (!n || !n.hasImage) return null;
      images.set(noteId, "pending");
      void Promise.resolve(call("notes.image", { noteId })).then(
        (o) => { const out = o as CapMap["notes.image"]["out"]; images.set(noteId, toDataUri(out.contentType, out.data)); ping(); },
        () => { images.set(noteId, "none"); ping(); },
      );
      return null;
    },
    linkImage(noteId) {
      const n = find(noteId);
      const had = linkImages.get(noteId);
      if (had === "pending" || had === "none") return null;
      if (had !== undefined) return had;
      if (!n?.link?.preview) return null;
      linkImages.set(noteId, "pending");
      void Promise.resolve(call("notes.image", { noteId, part: "link" })).then(
        (o) => { const out = o as CapMap["notes.image"]["out"]; linkImages.set(noteId, toDataUri(out.contentType, out.data)); ping(); },
        () => { linkImages.set(noteId, "none"); ping(); },
      );
      return null;
    },
    setImage(noteId, uri) { images.set(noteId, uri ?? "none"); ping(); },
    setSay(f) { say = f; },
  };
  return store;
}

const stores = new WeakMap<object, NotesStore>();

/** One store per Space runtime, so the sidebar, the page and a note opened from search share what they hold. */
export function notesStoreFor(rt: { call(cap: string, input: unknown): Promise<unknown> }): NotesStore {
  let s = stores.get(rt);
  if (!s) { s = createNotesStore((cap, input) => Promise.resolve(rt.call(cap, input))); stores.set(rt, s); }
  return s;
}
