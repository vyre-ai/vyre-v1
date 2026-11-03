// How a meeting happens (lane l-calevents, owner 3 Nov), the pure part: read from the provider's conference (Google conferenceData, Graph onlineMeeting, a Zoom meeting Vyre made),
// the join link, the location and the description. A video service with its dial-in and passcode; a phone call with its PIN; a place. Several at once: the video call leads,
// then the phone, then the place. None: the pane offers Add a video call.
import type { EventRow } from "./model.ts";

export type VideoProvider = "meet" | "zoom" | "teams" | "webex" | "whereby" | "around" | "other";
export interface Dial { number: string; pin?: string; label?: string }
export type Way =
  | { kind: "video"; provider: VideoProvider; url: string; dialIns: Dial[]; passcode?: string; meetingId?: string }
  | { kind: "phone"; number: string; pin?: string }
  | { kind: "place"; address: string };

export const PROVIDER_NAME: Readonly<Record<VideoProvider, string>> = { meet: "Google Meet", zoom: "Zoom", teams: "Teams", webex: "Webex", whereby: "Whereby", around: "Around", other: "the call" };

/** The video service a link belongs to, by its host; null for a link that is not a meeting (a document, a form). */
export function providerOf(url: string): VideoProvider | null {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (host === "meet.google.com") return "meet";
  if (host.endsWith("zoom.us") || host.endsWith("zoom.com")) return "zoom";
  if (host.endsWith("teams.microsoft.com") || host.endsWith("teams.live.com")) return "teams";
  if (host.endsWith("webex.com")) return "webex";
  if (host.endsWith("whereby.com")) return "whereby";
  if (host.endsWith("around.co")) return "around";
  return null;
}

const URLS = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g;
const PHONE = /(?:tel:)?(\+?\d[\d\s().-]{7,}\d)/;
const PIN = /\b(?:pin|passcode|access code|conference id|meeting id)\b[:\s#]*([\d\s]{3,}#?)/i;
const isPhone = (s: string): boolean => /^[+\d\s().-]{8,}$/.test(s.trim()) && (s.match(/\d/g) ?? []).length >= 7;
const isUrl = (s: string): boolean => /^https?:\/\//i.test(s.trim());

/** Every way to join the event, the primary first. */
export function waysOf(e: Pick<EventRow, "joinUrl" | "location" | "description"> & { conference?: EventRow["conference"] }): Way[] {
  const out: Way[] = [];
  const text = `${e.location ?? ""}\n${e.description ?? ""}`;
  // the video call: what the provider said, else the join link, else a meeting link in the location or the description
  const c = e.conference;
  const link = c?.url || e.joinUrl || [...text.matchAll(URLS)].map((m) => m[0]).find((u) => providerOf(u) !== null) || "";
  if (link) {
    const provider = (c && c.provider !== "other" ? c.provider : providerOf(link)) ?? "other";
    out.push({ kind: "video", provider, url: link, dialIns: c?.dialIns ?? [], ...(c?.passcode ? { passcode: c.passcode } : {}), ...(c?.meetingId ? { meetingId: c.meetingId } : {}) });
  }
  // a phone call: a number as the location, or a tel: link or a number with its PIN in the description, when no video call already carries the dial-in
  const loc = (e.location ?? "").trim();
  const tel = /tel:([+\d().\s-]{8,})/i.exec(e.description ?? "");
  const said = PHONE.exec(e.description ?? "");
  const number = isPhone(loc) ? loc : tel ? tel[1]!.trim() : !link && said && PIN.test(e.description ?? "") ? said[1]!.trim() : "";
  if (number && !(out[0]?.kind === "video" && out[0].dialIns.some((d) => d.number.replace(/\D/g, "") === number.replace(/\D/g, "")))) {
    const pin = PIN.exec(`${e.location ?? ""} ${e.description ?? ""}`)?.[1]?.trim();
    out.push({ kind: "phone", number, ...(pin ? { pin } : {}) });
  }
  // a place: a location that is neither a link nor a number
  if (loc && !isUrl(loc) && !isPhone(loc) && !(link && loc === link)) out.push({ kind: "place", address: loc });
  return out;
}

/** Open in Maps: the address on the map. */
export const mapsUrl = (address: string): string => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
/** A number to dial with the phone: tel: keeps the digits and the plus. */
export const telUrl = (number: string, pin?: string): string => `tel:${number.replace(/[^\d+]/g, "")}${pin ? `,,${pin.replace(/[^\d#]/g, "")}` : ""}`;

/** The video calls a new event can get: Meet on a Google calendar, Teams on a Microsoft one, Zoom when it is connected; the usual one first. */
export function videoOptions(calendarProvider: "google" | "microsoft" | "local" | undefined, zoom: boolean): Array<"meet" | "teams" | "zoom"> {
  const out: Array<"meet" | "teams" | "zoom"> = [];
  if (calendarProvider === "google") out.push("meet");
  if (calendarProvider === "microsoft") out.push("teams");
  if (zoom) out.push("zoom");
  return out;
}

/** The video call a new event starts with: the person's last pick when this calendar offers it, else the calendar's own (Meet, Teams), else Zoom, else none. */
export function videoDefault(options: readonly ("meet" | "teams" | "zoom")[], last: string | null): "meet" | "teams" | "zoom" | "none" {
  if (last === "none") return "none";
  if (last && (options as readonly string[]).includes(last)) return last as "meet" | "teams" | "zoom";
  return options[0] ?? "none";
}
