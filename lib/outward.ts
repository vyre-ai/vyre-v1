// What a held outward act is, in a person's words: who it goes to, by which channel, when, and what it says (as Markdown). One reading of the held call, used by the Gate to write the hold's card and by the
// card to read a hold parked before that (apps/app chats conversation held-card). Pure: no node imports, nothing here reads a secret or a field the person should not see ("timing", "online", ids).
// Capabilities: chat.message_person (a message to a person), mail.send (email), telephony.send_sms and twilio.sms.send (text), chat.post (a post in a thread or channel).

export type Channel = "message" | "email" | "text" | "post";
export interface Recipient { kind: "person" | "address" | "phone" | "thread"; /** a person's id or a thread id */ id?: string; /** an email address or a phone number */ address?: string; name?: string }
export interface Schedule { kind: "at" | "online"; at?: number }
export interface Outward {
  channel: Channel;
  to: Recipient[];
  subject?: string;
  /** What it says, as Markdown. */
  body: string;
  /** The input field the body lives in, so an edit goes back to the right place. */
  bodyField: "body" | "text";
  /** Only when it does not go now. */
  schedule?: Schedule;
  urgent?: boolean;
}

const OBJ = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const STR = (v: unknown): string => (typeof v === "string" ? v : "");
const NUM = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The capabilities whose held calls are a message going out. */
export const OUTWARD_CAPS: readonly string[] = ["chat.message_person", "mail.send", "telephony.send_sms", "twilio.sms.send", "chat.post"];

/** The held call as an outward act, or null when it is not one (or carries nothing to say). */
export function outwardOf(cap: string, input: unknown): Outward | null {
  const i = OBJ(input);
  switch (cap) {
    case "chat.message_person": {
      const to = STR(i["to"]);
      const at = NUM(i["at"]);
      const timing = i["timing"];
      return {
        channel: "message", to: to ? [{ kind: "person", id: to }] : [], body: STR(i["body"]), bodyField: "body",
        ...(timing === "at" && at !== undefined ? { schedule: { kind: "at" as const, at } } : timing === "online" ? { schedule: { kind: "online" as const } } : {}),
        ...(i["urgent"] === true ? { urgent: true } : {}),
      };
    }
    case "mail.send": {
      const list = Array.isArray(i["to"]) ? (i["to"] as unknown[]) : [];
      const to: Recipient[] = list.map((r) => { const o = OBJ(r); return { kind: "address" as const, address: STR(o["address"]), ...(STR(o["name"]) ? { name: STR(o["name"]) } : {}) }; }).filter((r) => r.address !== "");
      const at = NUM(i["sendAt"]);
      return { channel: "email", to, subject: STR(i["subject"]), body: STR(i["text"]), bodyField: "text", ...(at !== undefined ? { schedule: { kind: "at" as const, at } } : {}) };
    }
    case "telephony.send_sms": case "twilio.sms.send": {
      const to = STR(i["to"]);
      const at = NUM(i["sendAt"]);
      return { channel: "text", to: to ? [{ kind: "phone", address: to }] : [], body: STR(i["body"]), bodyField: "body", ...(at !== undefined ? { schedule: { kind: "at" as const, at } } : {}) };
    }
    case "chat.post": {
      const thread = STR(i["threadId"]);
      return { channel: "post", to: thread ? [{ kind: "thread", id: thread }] : [], body: STR(i["body"]), bodyField: "body" };
    }
    default: return null;
  }
}

/** The verb the header uses: "message Aliza Rizvi", "email aliza@example.com", "text +14155550123", "post in Lab 7 no-shows". */
export function verbOfChannel(o: Outward, names: (r: Recipient) => string): string {
  const who = o.to.map(names).filter(Boolean);
  const list = who.length === 0 ? "" : who.length <= 2 ? who.join(" and ") : `${who.slice(0, 2).join(", ")} and ${who.length - 2} more`;
  switch (o.channel) {
    case "message": return list ? `message ${list}` : "send a message";
    case "email": return list ? `email ${list}` : "send an email";
    case "text": return list ? `text ${list}` : "send a text";
    default: return list ? `post in ${list}` : "post a message";
  }
}

/** "Sends at 9:00 her time" is the card's to write (it knows the zone); this is the part the data decides: when it is not now, and how. */
export function scheduleWords(s: Schedule | undefined, when: (at: number) => string): string | null {
  if (!s) return null;
  return s.kind === "online" ? "Sends when they are next online" : s.at !== undefined ? `Sends ${when(s.at)}` : null;
}

/** The input with its body replaced, for an edit: only the body field changes (an email's HTML is dropped, since the text is what was edited). Null when the call is not one that can be edited. */
export function withBody(cap: string, input: unknown, markdown: string): Record<string, unknown> | null {
  const o = outwardOf(cap, input);
  if (!o) return null;
  const next: Record<string, unknown> = { ...OBJ(input), [o.bodyField]: markdown };
  if (cap === "mail.send") delete next["html"];
  return next;
}
