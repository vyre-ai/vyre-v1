// The sample Spaces behind the Settings screen tests and screenshots: Northwind (the default Space, filled from the prototype's Settings) and Harbor Studio. A fake replica holds the
// rows; every capability a page reads is registered with a resolver over those rows, and the writes a page makes (set, reset, copy, mute, revoke, leave) change the rows, so each
// control in a mount really works. The real replica is SQLite behind the same surface. The `ROWS` table is the person rows of the registry (generated/registry.json) with their titles.
import { createFakeReplica, createScreenHooks, liveQuery } from "../../../../../client/src/index.ts";
import type { FakeReplica, LiveQuery, Row, ScreenHooks } from "../../../../../client/src/index.ts";
import { screensById } from "../../../../../generated/screens.ts";
import { namesFor } from "../../fixtures/index.ts";
import type { CapMap } from "../../../../../generated/types.ts";
import type { SettingsData, SettingsNav, SpaceTile } from "./data.tsx";
import { searchRows } from "./model.ts";
import type { SettingRow } from "./model.ts";

export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const MIN = 60_000;
const DAY = 86_400_000;

type Def = Omit<SettingRow, "value" | "source" | "floorable"> & { value?: unknown };
const d = (key: string, scope: "space" | "person", page: string, title: string, def: unknown, value?: unknown): Def => ({ key, scope, page, title, default: def, ...(value !== undefined ? { value } : {}) }) as Def;

/** The person rows of the registry, in its order, plus the one Space row on the Notifications page. */
export const ROWS: readonly Def[] = [
  d("appearance.mode", "person", "appearance", "Light or dark", "system"),
  d("appearance.skin", "person", "appearance", "Skin", "classic"),
  d("chat.agent_tabs", "person", "Chats", "Let agents open and switch side tabs for me", true),
  d("chat.ask_agent", "person", "Models and usage", "Agent I last used in Ask panes", null),
  d("chrome.agents_use_my_browser", "person", "This computer", "Let agents use my Chrome (per Space, only that Space agents, with a visible indicator)", {}),
  d("engine.local_runs", "person", "This computer", "Run my private chats on this computer", true),
  d("engine.runtime_opt_in", "person", "Memory and privacy", "Let the Space continue my chats when my computer is off", true),
  d("engine.subscription_share", "person", "Models and usage", "Let the Space run work on my subscription", true),
  d("home.digest_schedule", "person", "Home", "When the assistant writes the While you were away digest", { at: "07:30", tz: "UTC" }),
  d("keyboard.overrides", "person", "keyboard", "Shortcuts", {}),
  d("kit.choice_person", "person", "kit", "My Kit in this Space", {}),
  d("kit.person_choice", "person", "appearance", "My Kit", null),
  d("memory.weekly_nudge", "person", "Memory and privacy", "Weekly reminder about proposed facts", true),
  d("notifications.email_backstop", "person", "Notifications", "Email me once if an approval waits 4 hours", true),
  d("notifications.push_idle_minutes", "space", "Notifications", "Minutes idle on the computer before pushes go to the phone", 5),
  d("notifications.working_hours", "person", "Notifications", "Working hours (outside them only calls, urgent approvals and incidents interrupt)", { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00", tz: "UTC" }),
  d("profile.contact", "person", "profile", "Contact", {}),
  d("profile.display_name", "person", "profile", "Name", ""),
  d("profile.handle", "person", "profile", "Handle", ""),
  d("profile.photo", "person", "profile", "Photo", null),
  d("profile.timezone", "person", "profile", "Time zone", "UTC"),
  d("profile.title", "person", "profile", "Title", ""),
  d("profile.working_hours", "person", "profile", "Working hours", { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" }),
  d("security.chrome_mode", "person", "This computer", "Chrome prompts on this computer (Ask, Allow or Auto; one value per Space)", { base: "ask", spaces: {} }),
  d("security.level", "person", "This computer", "Security level", "standard"),
  d("security.team_agents_on_my_computer", "person", "This computer", "Let team agents use my terminal (per Space, locked to a work folder)", {}),
  d("security.terminal_mode", "person", "This computer", "Terminal prompts on this computer (Ask, Allow or Auto; one value per Space)", { base: "ask", spaces: {} }),
  d("sync.blob_cache_mb", "person", "This computer", "File cache size on this computer (MB)", 2048),
];

export interface SampleSpace {
  id: "northwind" | "harbor";
  name: string;
  me: { id: string; name: string };
  names: Record<string, string>;
  values: Record<string, unknown>;
  spaces: SpaceTile[];
  /** What the other Space keeps for Copy from another Space. */
  other: CapMap["settings.copy_source"]["out"];
}

const hrs = { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:30" };

export const northwind: SampleSpace = {
  id: "northwind", name: "Northwind", me: { id: "usr_irfad", name: "Irfad Imtiaz" },
  names: namesFor("northwind", { ch_sales: "#sales" }),
  values: {
    "appearance.skin": "graphite", "profile.display_name": "Irfad Imtiaz", "profile.handle": "irfad", "profile.title": "Head of operations", "profile.timezone": "America/Los_Angeles",
    "profile.working_hours": hrs, "profile.contact": { email: "irfad@northwind.example", phone: "+1 415 555 0132" }, "engine.subscription_share": false, "engine.runtime_opt_in": false,
    "notifications.working_hours": { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00", tz: "America/Los_Angeles" },
  },
  spaces: [
    { id: "northwind", name: "Northwind", addr: "northwind.vyre.run", kind: "team", role: "Owner", needsYou: 0, current: true },
    { id: "harbor", name: "Harbor Studio", addr: "harbor.vyre.run", kind: "team", role: "Member", needsYou: 2, current: false },
    { id: "personal", name: "Personal", addr: "Only on this computer", kind: "personal", role: "Owner", needsYou: 0, current: false },
  ],
  other: { name: "Irfad Imtiaz", handle: "irfad", timezone: "America/Los_Angeles", hours: hrs, contact: { email: "irfad@harbor.example", phone: "+1 415 555 0132" } },
};

export const harbor: SampleSpace = {
  id: "harbor", name: "Harbor Studio", me: { id: "usr_june", name: "June Okafor" },
  names: namesFor("harbor"),
  values: { "profile.display_name": "June Okafor", "profile.handle": "june", "profile.title": "Designer", "profile.timezone": "Europe/London", "profile.contact": { email: "june@harborstudio.example" } },
  spaces: [
    { id: "harbor", name: "Harbor Studio", addr: "harbor.vyre.run", kind: "team", role: "Member", needsYou: 0, current: true },
    { id: "northwind", name: "Northwind", addr: "northwind.vyre.run", kind: "team", role: "Member", needsYou: 1, current: false },
  ],
  other: {},
};

export interface SampleSettings {
  data: SettingsData;
  replica: FakeReplica;
  space: SampleSpace;
  calls: { cap: string; input: unknown }[];
  opened: string[];
  previews: (string | null)[];
  failNext(cap: string): void;
}

const device = (id: string, name: string, cls: "desktop" | "phone" | "web" | "extension" | "daemon", ago: number, o: { current?: boolean; location?: string } = {}): Row => ({
  id, person: "usr_irfad", name, class: cls, epoch: 1, lastSeenAt: SAMPLE_NOW - ago, ...(o.current ? { current: true } : {}), ...(o.location ? { location: o.location } : {}),
});

export function createSampleSettings(space: SampleSpace = northwind): SampleSettings {
  const replica = createFakeReplica(space.id);
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const previews: (string | null)[] = [];
  const failing = new Set<string>();
  replica.put("settings", ROWS.map((r) => ({ id: r.key, ...r, ...(space.values[r.key] !== undefined ? { value: space.values[r.key] } : { value: r.default }) }) as unknown as Row));
  replica.put("devices", [
    device("dev_mac", "Irfad's MacBook Pro", "desktop", 0, { current: true, location: "San Francisco" }), device("dev_phone", "Irfad's iPhone", "phone", 3 * 60 * MIN, { location: "San Francisco" }),
    device("dev_web", "Chrome on a library computer", "web", 6 * DAY, { location: "Oakland" }), device("dev_old", "Old Windows laptop", "desktop", 30 * DAY),
  ]);
  replica.put("mutes", [{ id: "agt_docs", target: { kind: "agent", id: "agt_docs" }, until: SAMPLE_NOW + DAY }, { id: "ch_sales", target: { kind: "channel", id: "ch_sales" }, until: SAMPLE_NOW + 3 * DAY }]);
  replica.put("mailboxes", space.id === "northwind" ? [
    { id: "mbx_1", kind: "personal", address: "irfad@northwind.example", title: "Work", provider: "google", privacy: "private", state: "syncing", lastSyncAt: SAMPLE_NOW - 2 * MIN, ownerId: "usr_irfad" },
    { id: "mbx_2", kind: "personal", address: "irfad.imtiaz@outlook.example", title: "Outlook", provider: "microsoft", privacy: "people", state: "paused", ownerId: "usr_irfad" },
  ] : []);
  replica.put("accounts", [
    { id: "acc_claude", ref: "acc_claude", driver: "claude_code", kind: "subscription", title: "Claude Max, your sign-in", mine: true, status: "ok" },
    { id: "acc_openai", ref: "acc_openai", driver: "openai", kind: "api_key", title: "OpenAI team key", mine: false, status: "ok" },
    { id: "acc_ocg", ref: "acc_ocg", driver: "opencode_go", kind: "api_key", title: "OpenCode Go, your key", mine: true, status: "expired" },
  ]);
  replica.put("models", [
    { id: "m1", provider: "anthropic", model: "claude-sonnet-5-5", title: "Claude Sonnet 5.5", driver: "claude_code", allowed: true },
    { id: "m2", provider: "anthropic", model: "claude-haiku-5-5", title: "Claude Haiku 5.5", driver: "claude_code", allowed: true },
    { id: "m3", provider: "openai", model: "gpt-5", title: "GPT-5", driver: "openai", allowed: true },
    { id: "m4", provider: "opencode_go", model: "kimi", title: "OpenCode Go Kimi", driver: "opencode_go", allowed: false, reason: "not_connected" },
  ]);
  replica.put("defaults", [{ id: "d", provider: "anthropic", model: "claude-sonnet-5-5", fallback: [{ provider: "anthropic", model: "claude-haiku-5-5" }] }]);
  replica.put("usage", [
    { id: "claude", key: "claude", title: "Claude Max, your sign-in", totals: { turns: 412, tokensIn: 3_100_000, tokensOut: 640_000, costMicros: 0 } },
    { id: "openai", key: "openai", title: "OpenAI team key", totals: { turns: 168, tokensIn: 1_300_000, tokensOut: 240_000, costMicros: 48_200_000 } },
    { id: "ocg", key: "ocg", title: "OpenCode Go, your key", totals: { turns: 40, tokensIn: 220_000, tokensOut: 60_000, costMicros: 3_600_000 } },
  ]);
  replica.put("kits", [{ id: "kit_law", kitId: "kit_law", key: "law", title: "Law firm", version: "1.2.0", channel: "stable", installed: true, contents: ["ui", "structure"] }, { id: "kit_studio", kitId: "kit_studio", key: "studio", title: "Studio", version: "1.0.0", channel: "stable", installed: true, contents: ["ui"] }]);
  replica.put("kit", [{ id: "k", space: "kit_law", person: null, effective: "kit_law" }]);
  replica.put("other", [{ id: "o", ...space.other }]);

  const rowsNow = (): SettingRow[] => (replica.rows("settings") as unknown as (Row & { key: string; scope: "space" | "person"; page: string; title: string; value: unknown; default: unknown })[]).map((r) => ({
    key: r.key, scope: r.scope, page: r.page, title: r.title, value: r.value, default: r.default, source: JSON.stringify(r.value) === JSON.stringify(r.default) ? "default" : "person", floorable: false,
  }));
  replica.resolve("settings.list", (_t, input) => ({ rows: rowsNow().filter((r) => (input.page ? r.page === input.page : true) && (input.scope ? r.scope === input.scope : true)) }) as CapMap["settings.list"]["out"]);
  replica.resolve("settings.search", (_t, input) => ({ rows: searchRows(rowsNow(), input.q).map((h) => ({ key: h.key, page: h.page, title: h.title, score: h.score })) }) as CapMap["settings.search"]["out"]);
  replica.resolve("settings.copy_source", () => { const o = replica.rows("other")[0] as unknown as Record<string, unknown> | undefined; const { id: _i, ...rest } = o ?? {}; return rest as CapMap["settings.copy_source"]["out"]; });
  replica.resolve("devices.mine", () => ({ devices: (replica.rows("devices") as unknown as Row[]).filter((x) => x["revokedAt"] === undefined), sessions: [] }) as unknown as CapMap["devices.mine"]["out"]);
  replica.resolve("notifications.mute.list", () => ({ mutes: (replica.rows("mutes") as unknown as { target: { kind: string; id: string }; until: number }[]).map((m) => ({ target: m.target, until: m.until })) }) as CapMap["notifications.mute.list"]["out"]);
  replica.resolve("notifications.kinds.list", () => ({
    kinds: [
      { key: "approval.requested", level: "interrupt", place: "home", title: "An approval is asked of you", respectHours: false },
      { key: "dm", level: "interrupt", place: "chats", title: "A direct message", respectHours: true },
      { key: "mention", level: "interrupt", place: "chats", title: "A mention from a person", respectHours: true },
      { key: "task.assigned", level: "badge", place: "home", title: "A task given to you", respectHours: true },
      { key: "reply.followed", level: "badge", place: "chats", title: "Replies on things you follow", respectHours: true },
      { key: "digest.other", level: "digest", place: "home", title: "Everything else", respectHours: true },
    ],
  }) as unknown as CapMap["notifications.kinds.list"]["out"]);
  replica.resolve("mail.mailbox.list", () => ({ mailboxes: replica.rows("mailboxes") as unknown as CapMap["mail.mailbox.list"]["out"]["mailboxes"] }) as CapMap["mail.mailbox.list"]["out"]);
  replica.resolve("engine.accounts.list", () => ({ accounts: replica.rows("accounts") as unknown as CapMap["engine.accounts.list"]["out"]["accounts"] }) as CapMap["engine.accounts.list"]["out"]);
  replica.resolve("engine.models.list", () => ({ models: replica.rows("models") as unknown as CapMap["engine.models.list"]["out"]["models"] }) as CapMap["engine.models.list"]["out"]);
  replica.resolve("engine.defaults.get", () => { const x = replica.rows("defaults")[0] as unknown as { provider: string; model: string; fallback: { provider: string; model: string }[] }; return { provider: x.provider, model: x.model, fallback: x.fallback }; });
  replica.resolve("engine.usage.query", () => ({ rows: replica.rows("usage") as unknown as CapMap["engine.usage.query"]["out"]["rows"], totals: { turns: 620, tokensIn: 4_600_000, tokensOut: 940_000, costMicros: 51_800_000 } }) as CapMap["engine.usage.query"]["out"]);
  replica.resolve("kits.list", () => ({ kits: replica.rows("kits") as unknown as CapMap["kits.list"]["out"]["kits"] }) as CapMap["kits.list"]["out"]);
  replica.resolve("settings.kit.get", () => { const k = replica.rows("kit")[0] as unknown as { space: string | null; person: string | null; effective: string }; return { kit: { space: k.space, person: k.person, effective: k.effective } }; });

  const find = (key: string): Row => { const r = replica.rows("settings").find((x) => x.id === key); if (!r) throw new Error(`no such setting ${key}`); return r; };
  const writes: Record<string, (input: any) => unknown> = {
    "settings.set": (i: { key: string; value: unknown }) => {
      const cur = find(i.key);
      if (i.key === "profile.handle" && typeof i.value === "string" && i.value !== "" && !/^[a-z0-9_.-]{2,32}$/.test(i.value)) throw new Error("A handle is 2 to 32 letters, numbers, dots or dashes.");
      replica.put("settings", [{ ...cur, value: i.value }]);
      return { row: rowsNow().find((r) => r.key === i.key), previous: cur["value"] };
    },
    "settings.reset": (i: { key: string }) => { const cur = find(i.key); replica.put("settings", [{ ...cur, value: cur["default"] }]); return { row: rowsNow().find((r) => r.key === i.key) }; },
    "settings.copy_profile": (i: { fields: string[]; values: Record<string, unknown> }) => {
      const set = (key: string, v: unknown): void => { replica.put("settings", [{ ...find(key), value: v }]); };
      for (const f of i.fields) {
        if (f === "name") set("profile.display_name", i.values["name"]);
        else if (f === "handle") set("profile.handle", i.values["handle"]);
        else if (f === "timezone") set("profile.timezone", i.values["timezone"]);
        else if (f === "hours") set("profile.working_hours", i.values["hours"]);
        else if (f === "contact") set("profile.contact", i.values["contact"]);
        else if (f === "photo") set("profile.photo", i.values["photo"]);
      }
      return { applied: i.fields };
    },
    "settings.kit.set_mine": (i: { kitId: string | null }) => { const k = replica.rows("kit")[0]!; replica.put("kit", [{ ...k, person: i.kitId, effective: i.kitId ?? String(k["space"]) }]); return { kit: { person: i.kitId } }; },
    "engine.defaults.set": (i: { provider?: string; model?: string; fallback?: { provider: string; model: string }[] }) => { const cur = replica.rows("defaults")[0]!; replica.put("defaults", [{ ...cur, ...(i.provider ? { provider: i.provider } : {}), ...(i.model ? { model: i.model } : {}), ...(i.fallback ? { fallback: i.fallback } : {}) }]); return { ok: true }; },
    "notifications.mute.clear": (i: { target: { id: string } }) => { replica.remove("mutes", [i.target.id]); return { ok: true }; },
    "devices.revoke": (i: { deviceId: string }) => { const cur = replica.rows("devices").find((x) => x.id === i.deviceId); if (cur) replica.put("devices", [{ ...cur, revokedAt: SAMPLE_NOW }]); return { ok: true }; },
    "devices.revoke_others": () => { let n = 0; for (const x of replica.rows("devices")) if (!x["current"] && x["revokedAt"] === undefined) { replica.put("devices", [{ ...x, revokedAt: SAMPLE_NOW }]); n++; } return { revoked: n }; },
    "mail.mailbox.pause": (i: { mailboxId: string }) => { const m = replica.rows("mailboxes").find((x) => x.id === i.mailboxId); if (m) replica.put("mailboxes", [{ ...m, state: "paused" }]); return { ok: true }; },
    "mail.mailbox.resume": (i: { mailboxId: string }) => { const m = replica.rows("mailboxes").find((x) => x.id === i.mailboxId); if (m) replica.put("mailboxes", [{ ...m, state: "syncing" }]); return { ok: true }; },
    "spaces.leave": () => ({ ok: true }),
  };

  const base = createScreenHooks(replica, screensById);
  // the generated screen queries pass route and page parameters the fake hooks do not resolve; these are opened here with what they were given
  const screens: ScreenHooks = {
    query(screenId, name, state = {}) {
      if (screenId === "settings.page" && name === "rows") return liveQuery(replica, "settings.list", {}) as LiveQuery<unknown>;
      if (screenId === "settings.models-usage" && name === "usage") return liveQuery(replica, "engine.usage.query", { by: "model" }) as LiveQuery<unknown>;
      return base.query(screenId, name, state);
    },
  };
  const nav: SettingsNav = {
    openVault: () => void opened.push("vault"), openConsole: () => void opened.push("console"), openSpace: (id) => void opened.push(`space:${id}`), connect: (k) => void opened.push(`connect:${k}`),
    choosePhoto: async () => "fil_sample", previewSkin: (id) => void previews.push(id),
  };
  const data: SettingsData = {
    screens,
    async call(cap, input) {
      calls.push({ cap, input });
      if (failing.delete(cap)) throw new Error(`${cap} failed`);
      const w = writes[cap];
      if (w) return w(input);
      const r = replica.run(cap as keyof CapMap, input as never);
      if (r) return r.data;
      throw new Error(`no handler for ${cap}`);
    },
    peek: (cap, input) => replica.run(cap as keyof CapMap, input as never)?.data,
    me: space.me, space: { id: space.id, name: space.name }, spaces: space.spaces, name: (id) => space.names[id] ?? id, nav, clock: () => ({ now: SAMPLE_NOW, offsetMin: 0 }),
  };
  return { data, replica, space, calls, opened, previews, failNext: (cap) => void failing.add(cap) };
}
