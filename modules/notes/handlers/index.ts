// One handler per notes capability (lane L2).
import { clipPage, toRecord, toTask } from "./convert.ts";
import { createNote, getNote, labelNote, listNotes, noteImage, pinNote, searchNotes, updateNote } from "./notes.ts";
import { deleteNote, restoreNote, setNoteOwner, shareNote } from "./share.ts";

export const handlers = {
  "notes.create": createNote,
  "notes.get": getNote,
  "notes.list": listNotes,
  "notes.search": searchNotes,
  "notes.image": noteImage,
  "notes.update": updateNote,
  "notes.pin": pinNote,
  "notes.label": labelNote,
  "notes.share": shareNote,
  "notes.set_owner": setNoteOwner,
  "notes.delete": deleteNote,
  "notes.restore": restoreNote,
  "notes.to_task": toTask,
  "notes.to_record": toRecord,
  "notes.clip": clipPage,
};
