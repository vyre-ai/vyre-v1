// Handler table of the computers module for the capabilities this module implements so far: lifecycle, recording, screenshot and live view, timeline and sessions (P-L2_16).
// The Chrome, Screen and Files tools of the agent computer are later packets; they stay on their generated stubs until then.
import { configure, get, giveBack, health, list, provision, remove, sessionSignOut, sessionsList, sleep, takeOver, wake } from "./lifecycle.ts";
import { recordingDelete, recordingGet, recordingProcess, recordingsList, recordStart, recordStop, screenshot, skillFromStep, stream, timeline, timelineStep } from "./record.ts";

export const handlers = {
  "computers.list": list,
  "computers.get": get,
  "computers.provision": provision,
  "computers.configure": configure,
  "computers.remove": remove,
  "computers.wake": wake,
  "computers.sleep": sleep,
  "computers.take_over": takeOver,
  "computers.give_back": giveBack,
  "computers.health": health,
  "computers.sessions.list": sessionsList,
  "computers.session.sign_out": sessionSignOut,
  "computers.record_start": recordStart,
  "computers.record_stop": recordStop,
  "computers.recordings.list": recordingsList,
  "computers.recording.get": recordingGet,
  "computers.recording.process": recordingProcess,
  "computers.recording.delete": recordingDelete,
  "computers.screenshot": screenshot,
  "computers.stream": stream,
  "computers.timeline": timeline,
  "computers.timeline_step": timelineStep,
  "computers.skill_from_step": skillFromStep,
};
