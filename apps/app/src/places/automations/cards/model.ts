// The cards the Assistant draws in Ask Vyre, and in the Connect an app sheet, when a sentence names an app (owner, 13 Nov 2026, design Part 4A, 4E, 4F). Pure: the trail of ticked lines, "I understood N things",
// "Is this the one?", the credential card (one component for Ask Vyre, the sheet and the Vault's add-item sheet), the mapping card, waiting for the first submission, the test-lead approval, Allow and Ask-admin.
// Words about a real app come from the server (what it read, the steps in its own menu names); nothing here invents guidance. The secret a person types goes to one port that writes it to the Vault and nowhere else.

export interface AppRef {
  id: string;
  name: string;
}

// ---------------------------------------------------------------- the trail

export interface TrailLineIn {
  app: AppRef | null;
  text: string;
  state: "done" | "doing";
}
export interface TrailGroup {
  app: AppRef | null;
  lines: { text: string; state: "done" | "doing" }[];
}

/** Short ticked lines grouped by app, in the order the apps first appear; lines about no app come first. */
export function trailView(lines: readonly TrailLineIn[]): TrailGroup[] {
  const general: TrailGroup = { app: null, lines: [] };
  const groups: TrailGroup[] = [];
  for (const l of lines) {
    if (l.app === null) {
      general.lines.push({ text: l.text, state: l.state });
      continue;
    }
    let g = groups.find((x) => x.app?.id === l.app!.id);
    if (!g) groups.push((g = { app: l.app, lines: [] }));
    g.lines.push({ text: l.text, state: l.state });
  }
  return general.lines.length > 0 ? [general, ...groups] : groups;
}

// ---------------------------------------------------------------- I understood N things

export interface ClauseIn {
  order: number;
  kind: "action" | "unclear";
  text: string;
  app: AppRef | null;
}
export interface UnderstoodIn {
  trigger: { app: AppRef; text: string; typed?: string; how?: "name" | "alias" | "near" | "new" | "ask" };
  clauses: readonly ClauseIn[];
}
export interface UnderstoodCard {
  title: string;
  trigger: { app: AppRef; text: string };
  items: { n: number; app: AppRef | null; text: string; notSure: boolean }[];
  actions: ["Yes, that is it", "Change something"];
  /** More than six actions: two Automations, never one long chain. */
  split?: { title: "This is two promises. Split it?"; first: ClauseIn[]; second: ClauseIn[] };
}

export const MAX_ACTIONS = 6;

const lower = (s: string): string => (s === "" ? s : s.charAt(0).toLowerCase() + s.slice(1));

export function understoodCard(i: UnderstoodIn): UnderstoodCard {
  const wrote =
    i.trigger.typed && (i.trigger.how === "alias" || i.trigger.how === "near") ? ` (you wrote ${i.trigger.typed})` : "";
  const items = [...i.clauses]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({
      n: c.order,
      app: c.app,
      text: c.kind === "unclear" ? `Not sure: ${c.text}` : c.text,
      notSure: c.kind === "unclear",
    }));
  const n = items.length;
  const card: UnderstoodCard = {
    title: `I understood ${n} ${n === 1 ? "thing" : "things"}. Is that right?`,
    trigger: { app: i.trigger.app, text: `When ${lower(i.trigger.text)} on ${i.trigger.app.name}${wrote}` },
    items,
    actions: ["Yes, that is it", "Change something"],
  };
  if (n > MAX_ACTIONS) {
    const cut = Math.ceil(n / 2);
    const ordered = [...i.clauses].sort((a, b) => a.order - b.order);
    card.split = { title: "This is two promises. Split it?", first: ordered.slice(0, cut), second: ordered.slice(cut) };
  }
  return card;
}

// ---------------------------------------------------------------- Is this the one?

export interface FormIn {
  id: string;
  name: string;
  where: string;
  madeWith: string;
  picture?: string;
}
export interface FormChoiceCard {
  title: string;
  choices: { id: string; label: string; line?: string; picture?: string }[];
  actions: string[];
}

/** The forms the Assistant found on his site, with a small picture each, or the plugin question with I do not know as an honest choice. */
export function formChoiceCard(i: {
  site: string;
  forms: readonly FormIn[];
  plugins: readonly string[];
}): FormChoiceCard {
  if (i.forms.length === 0)
    return {
      title: "Which plugin sends your form?",
      choices: [...i.plugins.map((p) => ({ id: p, label: p })), { id: "", label: "I do not know" }],
      actions: [],
    };
  const n = i.forms.length;
  return {
    title: `I found ${n} ${n === 1 ? "form" : "forms"} on ${i.site}. Is this the one?`,
    choices: i.forms.map((f) => ({
      id: f.id,
      label: f.name,
      line: `${f.where}, made with ${f.madeWith}`,
      ...(f.picture ? { picture: f.picture } : {}),
    })),
    actions: ["Neither"],
  };
}

// ---------------------------------------------------------------- the credential card

export interface Credential {
  app: AppRef;
  mode: "key" | "signin";
  /** What to paste, in the app's own words ("Private app token"). */
  field: string;
  /** Steps in the app's own menu names, from the documentation the skill read. Null until it has read it. */
  guide: { steps: readonly string[]; source: string } | null;
  /** Where the card is drawn: the chat in Ask Vyre, the Connect an app sheet, or the Vault's add-item sheet. Only the frame differs. */
  frame: "chat" | "sheet" | "vault";
}
export interface CredState {
  /** What he typed. Held in memory only; cleared on save, refusal and discard. */
  value: string;
  how: boolean;
  stuck: 0 | 1 | 2 | 3;
  saved: boolean;
  refused: boolean;
  closing: boolean;
}
export const CRED_START: CredState = { value: "", how: false, stuck: 0, saved: false, refused: false, closing: false };

export type CredEvent =
  | { type: "input"; value: string }
  | { type: "save" }
  | { type: "saved" }
  | { type: "refused" }
  | { type: "how" }
  | { type: "stuck" }
  | { type: "browser" }
  | { type: "signed_in" }
  | { type: "close" }
  | { type: "keep" }
  | { type: "discard" };
export type CredEffect = { kind: "save"; value: string } | { kind: "open_browser" } | { kind: "close" } | null;

export function credentialStep(_c: Credential, s: CredState, e: CredEvent): { state: CredState; effect: CredEffect } {
  const to = (state: CredState, effect: CredEffect = null) => ({ state, effect });
  switch (e.type) {
    case "input":
      return to({ ...s, value: e.value, refused: false });
    case "save":
      return s.value.trim() === "" ? to(s) : to(s, { kind: "save", value: s.value });
    case "saved":
      return to({ ...s, value: "", saved: true, refused: false });
    case "refused":
      return to({ ...s, value: "", refused: true });
    case "how":
      return to({ ...s, how: !s.how });
    case "stuck":
      return to({ ...s, stuck: s.stuck === 0 ? 1 : s.stuck });
    case "browser":
      return to({ ...s, stuck: 2 }, { kind: "open_browser" });
    case "signed_in":
      return to({ ...s, stuck: 3 });
    case "close":
      return s.value.trim() === "" ? to(s, { kind: "close" }) : to({ ...s, closing: true });
    case "keep":
      return to({ ...s, closing: false });
    case "discard":
      return to({ ...s, value: "", closing: false }, { kind: "close" });
  }
}

export interface CredView {
  title: string | null;
  field: { label: string; masked: true; filled: boolean } | null;
  savedLine: string;
  actions: string[];
  saveEnabled: boolean;
  how: { steps: readonly string[]; source: string } | { finding: string } | null;
  stuck: { title: string; note: string; action: string } | { done: string } | null;
  refusedLine: string | null;
  confirmClose: "Keep what you typed?" | null;
  /** Set once saved: the card collapses to this one line. */
  doneLine: string | null;
}

export function credentialView(c: Credential, s: CredState): CredView {
  const name = c.app.name;
  const inChat = c.frame === "chat";
  const savedLine =
    c.mode === "signin"
      ? `Saved to your Vault as “${name}”. ${inChat ? "Only you and this Automation can use it." : "Only you can use it."}`
      : inChat
        ? `Saved to your Vault as “${name}”, never typed into the chat. Only you and this Automation can use it.`
        : `Saved to your Vault as “${name}”. Only you can use it.`;
  const noun = c.field.trim().split(/\s+/).at(-1)?.toLowerCase() || "key";
  const base: CredView = {
    title: c.mode === "signin" ? `Sign in to ${name}` : `Paste your ${name} ${c.field}`,
    field: c.mode === "signin" ? null : { label: c.field, masked: true, filled: s.value !== "" },
    savedLine,
    actions:
      c.mode === "signin" ? [`Sign in with ${name}`] : ["Save", s.how ? "Hide steps" : "Show me how", "I am stuck"],
    saveEnabled: s.value.trim() !== "",
    how: null,
    stuck: null,
    refusedLine: s.refused ? `${name} did not accept that ${noun}.` : null,
    confirmClose: s.closing ? "Keep what you typed?" : null,
    doneLine: null,
  };
  if (s.saved)
    return {
      ...base,
      title: null,
      field: null,
      actions: [],
      doneLine: `${c.mode === "signin" ? `Signed in to ${name}. ` : ""}${savedLine}`,
    };
  if (s.how && c.mode === "key")
    base.how = c.guide
      ? {
          steps: c.guide.steps,
          source: `Written from ${c.guide.source}. Kept for your Space with its date and source.`,
        }
      : { finding: `Finding how to connect ${name}` };
  if (s.stuck === 1)
    base.stuck = {
      title: "I can look at the page with you, or do it in my own browser.",
      note: "You sign in yourself. I never see the password.",
      action: "Use my browser",
    };
  if (s.stuck === 2)
    base.stuck = {
      title: `${name} asks you to sign in, in my browser.`,
      note: "Type your password there. I never see it. I wait.",
      action: "I am signed in",
    };
  if (s.stuck === 3) base.stuck = { done: "I opened the page for the key. Create it, copy it and paste it above." };
  return base;
}

// ---------------------------------------------------------------- mapping, waiting, test lead, allow, ask admin

export function mappingCard(i: {
  app: AppRef;
  noun: string;
  pairs: readonly (readonly [string, string])[];
  unmatched: { field: string; choices: readonly { id: string; label: string }[] } | null;
}) {
  return {
    title: `How the form fills the ${i.noun} in ${i.app.name}`,
    app: i.app,
    rows: [
      ...i.pairs.map(([from, to]) => ({ from, to })),
      ...(i.unmatched ? [{ from: i.unmatched.field, to: null }] : []),
    ] as { from: string; to: string | null }[],
    line: i.unmatched ? `Nothing in ${i.app.name} takes “${i.unmatched.field}”.` : null,
    choices: i.unmatched?.choices ?? [],
    actions: i.unmatched ? i.unmatched.choices.map((c) => c.label) : [],
  };
}

export function waitingCard(i: { app: AppRef; url: string; remindAfterHours: number }) {
  return {
    title: "Waiting for the first real submission",
    app: i.app,
    url: i.url,
    note: `I remind you once after ${i.remindAfterHours} hours.`,
    actions: ["Check now"],
  };
}

export function testLeadCard(i: { app: AppRef; noun: string; testName: string; where: string }) {
  return {
    title: `Try it with a test ${i.noun}?`,
    app: i.app,
    line: `This writes one ${i.noun} called “${i.testName}” in ${i.where}, then removes it. The other steps send nothing.`,
    actions: ["Create, then remove", "Skip"],
    /** A write: it never happens without his tap. */
    write: true,
  };
}

export function allowCard(i: { app: string; item: string; ctx: "build" | "setup" }) {
  return i.ctx === "setup"
    ? {
        title: `Let Assistant use ${i.item} to set this up?`,
        line: `It reads the key once to connect ${i.app}. Nobody sees the key.`,
        actions: ["Allow", "Not now"],
      }
    : {
        title: `Let Assistant use ${i.app} for this Automation?`,
        line: `The draft uses your ${i.item} item from Vault. It works only inside this Automation.`,
        actions: ["Allow", "Not now"],
      };
}

export function askAdminCard(i: { app: string; admin: string }) {
  return {
    title: `Ask ${i.admin} to allow ${i.app}?`,
    line: `${i.app} is not connected for you, and only an admin can connect it.`,
    actions: [`Ask ${i.admin}`],
  };
}

/** One Needs you at a time, in the order the Assistant will ask. He leaves midway; the same line waits where he stopped. */
export function nextNeed<T extends { stage: number }>(needs: readonly T[]): T | null {
  return needs.reduce<T | null>((best, n) => (best === null || n.stage < best.stage ? n : best), null);
}
