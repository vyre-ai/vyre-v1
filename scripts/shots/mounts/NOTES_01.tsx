// Mount for Notes (lane l-notes): the Chats place on Notes over scripted notes capabilities, with the approved prototype's notes, pictures and people. ?part=
//   grid (the sidebar's Notes row and the grid, Pinned then Others), take (Take a note open), paste (a pasted image and a link read into a card), reading (the link still being read),
//   clip (a page clipped from Vyre for Chrome, opened), open (a note opened to edit), share (the share sheet), labels (the label filter open), ask (Ask about this note),
//   task (Turn into task), record (Turn into record), empty (no notes yet), phone (the phone grid), phone-note (a note open on the phone), phone-sheet (its action sheet).
// The query is read after mount (the static export keeps the first frame's markup), so the first frame is empty and the client draws the same one.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { ChatsMounted } from "../../../apps/app/src/places/chats/mounts/ChatsMounted.tsx";
import { SidebarSlot, SidebarSlotProvider } from "../../../apps/app/src/shell/sidebar/index.ts";
import { NotesPage } from "../../../apps/app/src/places/chats/notes/NotesPage.tsx";
import type { NotesInitial } from "../../../apps/app/src/places/chats/notes/NotesPage.tsx";
import { createMountSample, PEOPLE } from "../../../apps/app/src/places/chats/mounts/sample.ts";
import { START, step } from "../../../apps/app/src/places/chats/mounts/route.ts";
import type { Note } from "../../../apps/app/src/places/chats/notes/model.ts";
import type { ShellRuntime } from "../../../apps/app/src/shell/providers/runtime.tsx";

export const title = "Notes";

const ME = "usr_irfad";
const NOW = Date.UTC(2026, 10, 3, 4, 30);
const at = (d: number, h: number, m: number): number => Date.UTC(2026, 10, d, h - 5, m);
const F = 'font-family="-apple-system,Helvetica,Arial,sans-serif"';
// pictures: screenshots and previews keep their own colours in both skins (the prototype's)
const SVG: Record<string, string> = {
  luma: (() => { const d = [96, 112, 121, 133, 150, 161, 194, 212]; const bars = d.map((v, i) => `<rect x="${172 + i * 17}" y="${150 - v * 0.42}" width="11" height="${v * 0.42}" rx="2" fill="${i === 7 ? "#E15C3F" : "#F4C3B5"}"/>`).join(""); return `<svg viewBox="0 0 320 176" xmlns="http://www.w3.org/2000/svg" ${F}><rect width="320" height="176" fill="#FFFFFF"/><rect width="320" height="24" fill="#F3F2F5"/><circle cx="12" cy="12" r="3" fill="#E36A5A"/><circle cx="22" cy="12" r="3" fill="#E9B44C"/><circle cx="32" cy="12" r="3" fill="#69BF64"/><rect x="48" y="6" width="150" height="12" rx="6" fill="#E6E4EA"/><text x="56" y="15" font-size="7.5" fill="#6B6875">lu.ma/manage/lab-8</text><text x="14" y="44" font-size="10.5" font-weight="600" fill="#151319">Lab 8: Claude reads your intake calls</text><text x="14" y="57" font-size="8" fill="#7A7685">Thu 6 Nov, 6:00 PM ET · Zoom</text><text x="14" y="98" font-size="30" font-weight="700" fill="#151319">212</text><text x="14" y="112" font-size="8.5" fill="#7A7685">registered</text><text x="14" y="138" font-size="8" fill="#16805A">+18 since yesterday</text><text x="14" y="150" font-size="8" fill="#7A7685">Lab 7 ended at 280</text>${bars}<line x1="168" y1="150.5" x2="308" y2="150.5" stroke="#E6E4EA"/><text x="172" y="162" font-size="7" fill="#9A96A4">27 Oct</text><text x="284" y="162" font-size="7" fill="#9A96A4">3 Nov</text></svg>`; })(),
  bg: (() => { const f = (y: number, t: string): string => `<rect x="210" y="${y}" width="86" height="14" rx="3" fill="#F1EFEA"/><text x="214" y="${y + 9.5}" font-size="6.5" fill="#8A877F">${t}</text>`; return `<svg viewBox="0 0 320 190" xmlns="http://www.w3.org/2000/svg" ${F}><rect width="320" height="190" fill="#F7F5F0"/><rect width="320" height="30" fill="#0E2A47"/><text x="14" y="19" font-size="9.5" font-weight="700" letter-spacing="1.2" fill="#fff">BAILEY &amp; GALYEN</text><text x="196" y="19" font-size="7.5" fill="#C9D4E2">Practice areas   Locations   Contact</text><text x="14" y="58" font-size="15" font-weight="700" fill="#0E2A47">Hurt in Texas?</text><text x="14" y="76" font-size="15" font-weight="700" fill="#0E2A47">Talk to a lawyer today.</text><rect x="12" y="88" width="132" height="14" fill="#FFE58A"/><text x="14" y="98" font-size="8.5" fill="#1C2733">Call us 24/7. Se habla español.</text><rect x="12" y="103" width="92" height="14" fill="#FFE58A"/><text x="14" y="113" font-size="8.5" fill="#1C2733">No fee unless we win.</text><rect x="14" y="132" width="92" height="22" rx="4" fill="#C8102E"/><text x="25" y="146" font-size="8.5" font-weight="600" fill="#fff">Free consultation</text><rect x="200" y="44" width="106" height="134" rx="6" fill="#fff" stroke="#E2DED5"/><text x="210" y="60" font-size="8" font-weight="600" fill="#0E2A47">Tell us what happened</text>${f(68, "Type of accident")}${f(88, "When did it happen?")}${f(108, "Were you hurt?")}${f(128, "Phone")}<rect x="210" y="152" width="86" height="16" rx="3" fill="#0E2A47"/><text x="238" y="163" font-size="7" fill="#fff">Continue</text></svg>`; })(),
  skool: `<svg viewBox="0 0 320 120" xmlns="http://www.w3.org/2000/svg" ${F}><rect width="320" height="120" fill="#1D1B22"/><rect x="232" y="18" width="70" height="84" rx="10" fill="#2B2833"/><circle cx="267" cy="50" r="16" fill="#F3B33D"/><text x="259" y="56" font-size="16" font-weight="800" fill="#1D1B22">M</text><text x="250" y="86" font-size="8" fill="#A9A4B6">AI Labs</text><text x="16" y="30" font-size="9" font-weight="600" fill="#F3B33D">MLA AI LABS</text><text x="16" y="56" font-size="17" font-weight="700" fill="#fff">Lab 8: Claude reads</text><text x="16" y="76" font-size="17" font-weight="700" fill="#fff">your intake calls</text><text x="16" y="98" font-size="9" fill="#A9A4B6">Thu 6 Nov · 6:00 PM ET · Zoom</text></svg>`,
  lawm: `<svg viewBox="0 0 320 120" xmlns="http://www.w3.org/2000/svg" ${F}><rect width="320" height="120" fill="#22304F"/><rect x="200" y="22" width="104" height="10" rx="3" fill="#33446B"/><rect x="200" y="40" width="80" height="10" rx="3" fill="#33446B"/><rect x="200" y="58" width="96" height="10" rx="3" fill="#33446B"/><rect x="200" y="76" width="64" height="10" rx="3" fill="#4C64A0"/><text x="16" y="34" font-size="9" fill="#9FB0D6">Help Center</text><text x="16" y="62" font-size="20" font-weight="700" fill="#fff">Custom fields</text><text x="16" y="84" font-size="9.5" fill="#C9D3EA">Create, map to forms, use in the API</text></svg>`,
  reel: `<svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg" ${F}><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2A1F5C"/><stop offset="1" stop-color="#0F0E14"/></linearGradient></defs><rect width="320" height="180" fill="url(#rg)"/><text x="18" y="34" font-size="9" font-weight="600" fill="#B9AEFF">LAB 8 · REEL 1</text><text x="18" y="70" font-size="18" font-weight="700" fill="#fff">3 questions Claude asks</text><text x="18" y="92" font-size="18" font-weight="700" fill="#fff">on every intake call</text><circle cx="276" cy="134" r="20" fill="rgba(255,255,255,.16)"/><path d="M270 124v20l16-10z" fill="#fff"/><text x="18" y="160" font-size="9" fill="#A9A4B6">0:42 · cut by Aliza</text></svg>`,
  board: (() => { const H = 'font-family="Marker Felt,Chalkboard SE,Comic Sans MS,cursive"'; const b = (x: number, t: string): string => `<rect x="${x}" y="52" width="62" height="30" rx="6" fill="none" stroke="#2A4BA0" stroke-width="2"/><text x="${x + 31}" y="72" text-anchor="middle" font-size="12" fill="#2A4BA0" ${H}>${t}</text>`; return `<svg viewBox="0 0 320 170" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="170" fill="#ECEAE2"/><rect x="8" y="8" width="304" height="154" rx="4" fill="#F6F5F0"/><text x="20" y="34" font-size="13" fill="#C0392B" ${H}>Intake triage skill</text>${b(18, "Call")}${b(92, "Transcript")}${b(166, "Triage")}${b(240, "Route")}<path d="M80 67h10M154 67h10M228 67h10" stroke="#2A4BA0" stroke-width="2"/><text x="20" y="112" font-size="12" fill="#333" ${H}>PI in Kings or Queens: Sarah</text><text x="20" y="132" font-size="12" fill="#333" ${H}>everything else: front desk</text><text x="20" y="152" font-size="12" fill="#C0392B" ${H}>Spanish? flag it</text></svg>`; })(),
};
const b64 = (s: string): string => (globalThis as { btoa?: (s: string) => string }).btoa?.(unescape(encodeURIComponent(s))) ?? "";
const uri = (k: string): string => `data:image/svg+xml;base64,${b64(SVG[k]!)}`;

const n = (id: string, o: Partial<Note>): Note => ({
  noteId: id, owner: ME, title: "", body: "", color: "", pinned: false, labels: [], hasImage: false, linked: [], share: { people: [], space: "off" }, mine: true, canEdit: true, createdAt: at(1, 9, 0), updatedAt: at(1, 9, 0), ...o,
});
function notes(clipFresh: boolean): Note[] {
  const clip = n("n5", { title: "Bailey & Galyen consult page", hasImage: true, clip: { url: "https://baileyandgalyen.com/free-consultation", title: "Free consultation", selection: "Call us 24/7. Se habla español. No fee unless we win.", hasShot: true, at: clipFresh ? NOW - 40_000 : at(3, 10, 42) }, body: "Three questions before the phone number. Try this order on the Weinberger form.", labels: ["Clients", "Reading"], createdAt: clipFresh ? NOW - 40_000 : at(3, 10, 42), updatedAt: clipFresh ? NOW - 40_000 : at(3, 10, 42) });
  const rest = [
    n("n1", { title: "Lab 8 run of show", body: "6:00 doors open, Zoom waiting room\n6:05 Andrey welcome, two minutes\n6:08 Claude reads a PI intake call live\n6:30 Build the intake triage skill together\n6:50 Poll: which practice area next\n6:55 Q&A, Aliza runs the chat", labels: ["Lab 8"], color: "lilac", pinned: true, share: { people: [{ personId: "usr_aliza", role: "edit" }, { personId: "usr_andrey", role: "view" }], space: "off" }, updatedAt: at(3, 9, 14) }),
    n("n2", { title: "Weinberger intake call, 31 Oct", body: "Joe wants PI leads routed by county: Kings and Queens to Sarah, everything else to the front desk.\nSend him the Lawmatics custom field list by Wed.\nHe pays the DFY balance after the first live week.\nAsked if the form can flag Spanish speakers.", labels: ["Clients"], pinned: true, updatedAt: Date.UTC(2026, 9, 31, 12, 30) }),
    n("n3", { title: "Lab 8 registrations, Mon", hasImage: true, body: "212 on Luma. Lab 7 ended at 280. The Skool post brought 9 in two hours.", labels: ["Lab 8"], pinned: true, updatedAt: at(2, 9, 20) }),
    ...(clipFresh ? [] : [clip]),
    n("n6", { title: "Reel ideas for Lab 8", body: "1. Three questions Claude asks on every intake call\n2. Before and after: a 40 minute intake note in 2 minutes\n3. Andrey reacts to a live demo", labels: ["Lab 8"], color: "sand", owner: "usr_aliza", mine: false, share: { people: [{ personId: ME, role: "edit" }], space: "off" }, updatedAt: at(1, 16, 0) }),
    n("n4", { link: { url: "https://docs.lawmatics.com/custom-fields", title: "Custom fields: create, map to forms, use in the API", siteName: "Lawmatics Help Center", image: uri("lawm"), description: "Field types, API names, and how intake forms fill matters." }, body: "For the Weinberger field list", labels: ["Clients"], updatedAt: at(1, 11, 0) }),
    n("n7", { title: "GT+ pricing", body: "$1,500 a month, 3 month minimum. Andrey confirms Thursday, then the GHL pipeline goes live.", labels: ["Sales"], color: "rose", share: { people: [], space: "view" }, updatedAt: Date.UTC(2026, 9, 30, 9, 0) }),
    n("n10", { title: "Whiteboard, triage skill", hasImage: true, labels: ["Lab 8"], updatedAt: at(1, 12, 0) }),
    n("n8", { title: "Compliance workshop: what people asked", body: "Where do the files we upload live?\nWho owns the prompts we write?\nDo clients need to know when AI takes notes?", labels: ["Reading"], color: "sky", updatedAt: Date.UTC(2026, 9, 28, 9) }),
    n("n9", { title: "Laura Lee, probate", body: "Co-host one probate Lab in December. She brings 40 estate firms. Split the replay list.", labels: ["Partners"], color: "sage", updatedAt: Date.UTC(2026, 9, 27, 9) }),
  ];
  return clipFresh ? [clip, ...rest] : rest;
}
const IMAGE_OF: Record<string, string> = { n3: "luma", n5: "bg", n10: "board" };
const TYPES = [
  { key: "client", title: "Client", plural: "Clients", icon: "", label: "internal", system: false, titleField: "name", summaryField: "stage", version: 1, fields: [{ key: "name", type: "text", title: "Name" }, { key: "contact", type: "text", title: "Contact" }, { key: "stage", type: "text", title: "Stage" }, { key: "owner", type: "text", title: "Owner" }] },
  { key: "contact", title: "Contact", plural: "Contacts", icon: "", label: "internal", system: false, titleField: "name", version: 1, fields: [{ key: "name", type: "text", title: "Name" }, { key: "firm", type: "text", title: "Firm" }, { key: "role", type: "text", title: "Role" }] },
  { key: "lead", title: "Lead", plural: "Leads", icon: "", label: "internal", system: false, titleField: "name", version: 1, fields: [{ key: "name", type: "text", title: "Name" }, { key: "source", type: "text", title: "Source" }, { key: "interest", type: "text", title: "Interest" }] },
];
const PEOPLE_MLA = [
  ...PEOPLE.filter((p) => p.id === ME || p.kind === "agent"),
  { id: "usr_aliza", name: "Aliza", kind: "person" as const }, { id: "usr_andrey", name: "Andrey", kind: "person" as const }, { id: "usr_jason", name: "Jason", kind: "person" as const },
];

/** The sample runtime with the notes capabilities answered from memory, as the notes module would for Irfad. */
function notesRuntime(part: string): ShellRuntime {
  const sample = createMountSample({ who: "member" });
  let rows = part === "empty" ? [] : notes(part === "clip");
  const gone = new Set<string>();
  const base = sample.rt;
  const out = (id: string): { note: Note } => ({ note: rows.find((x) => x.noteId === id)! });
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as Record<string, unknown> & { noteId: string };
    switch (cap) {
      case "notes.list": { const live = rows.filter((x) => !gone.has(x.noteId)); const sorted = [...live.filter((x) => x.pinned), ...live.filter((x) => !x.pinned)]; return { notes: sorted, labels: ["Lab 8", "Clients", "Sales", "Partners", "Reading"].map((name) => ({ name, count: live.filter((x) => x.labels.includes(name)).length })) }; }
      case "notes.get": return out(i.noteId);
      case "notes.image": { const k = IMAGE_OF[i.noteId]; if (!k) throw new Error("no image"); return { contentType: "image/svg+xml", data: b64(SVG[k]!) }; }
      case "notes.create": { const id = `n${rows.length + 20}`; const c = i as unknown as { title?: string; body?: string; color?: Note["color"]; pinned?: boolean; labels?: string[]; image?: unknown; link?: string }; const made = n(id, { title: c.title ?? "", body: c.body ?? "", color: c.color ?? "", pinned: c.pinned === true, labels: c.labels ?? [], hasImage: !!c.image, ...(c.link ? { link: { url: c.link, siteName: "Skool", title: "Lab 8: Claude reads your intake calls" } } : {}), createdAt: NOW, updatedAt: NOW }); rows = [made, ...rows]; return { note: made }; }
      case "notes.update": case "notes.pin": case "notes.label": case "notes.share": {
        rows = rows.map((x) => {
          if (x.noteId !== i.noteId) return x;
          const y = { ...x, updatedAt: NOW };
          if (cap === "notes.pin") y.pinned = i["pinned"] === true;
          if (cap === "notes.update") for (const k of ["title", "body", "color"] as const) if (typeof i[k] === "string") (y as Record<string, unknown>)[k] = i[k];
          if (cap === "notes.label") y.labels = [...x.labels.filter((l) => !((i["remove"] as string[] | undefined) ?? []).includes(l)), ...((i["add"] as string[] | undefined) ?? []).filter((l) => !x.labels.includes(l))];
          if (cap === "notes.share") { let p = x.share.people.slice(); for (const q of (i["people"] as { personId: string; role: string }[] | undefined) ?? []) { p = p.filter((z) => z.personId !== q.personId); if (q.role !== "remove") p.push({ personId: q.personId, role: q.role as "edit" | "view" }); } y.share = { people: p, space: (i["space"] as Note["share"]["space"] | undefined) ?? x.share.space }; }
          return y;
        });
        return out(i.noteId);
      }
      case "notes.delete": gone.add(i.noteId); return { deleted: true, undo: { noteId: i.noteId } };
      case "notes.restore": gone.delete(i.noteId); return out(i.noteId);
      case "notes.to_task": rows = rows.map((x) => (x.noteId === i.noteId ? { ...x, linked: [...x.linked, { kind: "task" as const, id: "tsk_318", title: String(i["title"] ?? x.title), at: NOW }] } : x)); return { ...out(i.noteId), taskId: "tsk_318" };
      case "notes.to_record": rows = rows.map((x) => (x.noteId === i.noteId ? { ...x, linked: [...x.linked, { kind: "record" as const, id: "rec_77", title: "Weinberger Law", at: NOW }] } : x)); return { ...out(i.noteId), recordId: "rec_77" };
      case "tasks.get": return { task: { id: "tsk_318", key: "VY-318", title: "Send Joe the Lawmatics custom field list" } };
      case "schema.describe": return { types: TYPES };
      case "automations.read_link": {
        if (part === "reading") return new Promise(() => undefined);
        await new Promise((r) => setTimeout(r, 300));
        return { ok: true, meta: { title: "Lab 8: Claude reads your intake calls", siteName: "Skool", image: uri("skool"), description: "MLA AI Labs · Thu 6 Nov, 6:00 PM ET" } };
      }
      // Ask about this note: its own new Ask thread (the sample's chats are another Space's)
      case "chat.start": if ((input as { kind?: string }).kind === "ask") return { thread: { threadId: "t_note_ask", kind: "ask", title: "Weinberger intake call, 31 Oct", listed: false, planMode: false, members: [{ kind: "person", id: ME }], agents: [{ agentId: "agt_assistant", mode: "lead" }], createdAt: NOW } }; return base.call(cap, input);
      case "agents.list": if ((input as { section?: string }).section === "personal") return { agents: [{ agentId: "agt_assistant", ownerId: ME, kind: "assistant", name: "Assistant" }] }; return base.call(cap, input);
      default: return base.call(cap, input);
    }
  };
  const people = { status: "ready" as const, data: PEOPLE_MLA };
  return {
    ...base, call: call as ShellRuntime["call"], me: { ...base.me, id: ME, name: "Irfad Imtiaz" }, space: { id: "mla", kind: "team", name: "My Legal Academy" },
    principals: { subscribe: () => () => undefined, getSnapshot: () => people }, clock: () => ({ now: NOW, offsetMin: 300 }),
  };
}

// the screenshots' link to the link card in the image: the fixture's read answers with its picture
const TAKE: Record<string, NotesInitial["take"]> = {
  take: { open: true, title: "JCS Law, Windows setup", body: "Josh says the sync runs on his Mac, but the office PCs are Windows 11.\nSend him the installer link and the two settings to change." },
  paste: { open: true, title: "Lab 8 promo", body: "Reel 1 is cut. Post it with the Skool link on Tuesday.", labels: ["Lab 8"], reading: "https://skool.com/mla-ai-labs/lab-8" },
  reading: { open: true, title: "Lab 8 promo", body: "Reel 1 is cut. Post it with the Skool link on Tuesday.", labels: ["Lab 8"], reading: "https://skool.com/mla-ai-labs/lab-8" },
};

function initialOf(part: string): NotesInitial {
  const take = TAKE[part];
  const withImage = take && (part === "paste" || part === "reading") ? { ...take, image: { data: b64(SVG["reel"]!), contentType: "image/png" as const, uri: uri("reel") } } : take;
  switch (part) {
    case "clip": return { open: "n5" };
    case "open": return { open: "n2" };
    case "share": return { share: "n2" };
    case "labels": return { filter: ["Lab 8"], filterMenu: true };
    case "ask": return { ask: "n2" };
    case "task": return { task: { noteId: "n2", title: "Send Joe the Lawmatics custom field list", due: "Thu 5 Nov" } };
    case "record": return { record: { noteId: "n2", type: "client" } };
    case "phone-note": return { phoneOpen: "n2" };
    case "phone-sheet": return { phoneOpen: "n2", phoneSheet: true };
    default: return withImage ? { take: withImage } : {};
  }
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "grid"), []);
  const rt = useMemo(() => (part === null ? null : notesRuntime(part)), [part]);
  // a phone-sized window draws the page as the phone does
  const narrow = useWindowDimensions().width < 560;
  if (part === null || rt === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const initial = initialOf(part);
  if (part.startsWith("phone") || narrow) {
    return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}><NotesPage key={part} rt={rt} nameOf={(id) => PEOPLE_MLA.find((p) => p.id === id)?.name ?? id} initial={initial} phone /></View>;
  }
  // the place as the shell draws it: the shared sidebar slot (Chats, with the Notes row) beside the page
  return (
    <SidebarSlotProvider deviceId="d1" personId={ME} spaceId="mla" place="chats" epoch={1} compact={false} storage={{ getItem: () => null, setItem: () => undefined }}>
      <View style={{ flex: 1, flexDirection: "row", minHeight: 0, backgroundColor: "var(--win)" as string }}>
        <SidebarSlot />
        <View style={{ flex: 1, minWidth: 0 }}><ChatsMounted key={part} rt={rt} initial={step(START, { t: "notes" })} window={{ start: 0, end: 500 }} notesInitial={initial} openInNewTab={() => undefined} /></View>
      </View>
    </SidebarSlotProvider>
  );
}
