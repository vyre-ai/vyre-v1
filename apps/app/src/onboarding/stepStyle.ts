// How a setup step looks wherever it is listed: a 16 px stroke icon on a gradient tile. One map, so Home's checklist and the onboarding screen draw the same step the same way.
import type { FlowKind } from "./flow.ts";

export interface StepLook { icon: readonly string[]; from: string; to: string }

const L = (icon: readonly string[], from: string, to: string): StepLook => ({ icon, from, to });
const SPARK = ["M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2"];
const BRIEF = ["M2.5 5h11v8h-11z", "M6 5V3.500h4V5"];
const CHAT = ["M3 3.500h10a1 1 0 011 1v6a1 1 0 01-1 1H7l-3 2.500v-2.500H3a1 1 0 01-1-1v-6a1 1 0 011-1z"];
const FOLDER = ["M2.500 4.500a1 1 0 011-1h3l1.500 1.500h4.500a1 1 0 011 1v6.500a1 1 0 01-1 1h-9a1 1 0 01-1-1z"];
const CHROME = ["M8 2.500a5.500 5.500 0 100 11 5.500 5.500 0 000-11z", "M8 6a2 2 0 100 4 2 2 0 000-4z", "M8 6h5.200M5.600 9.500L3 5M10.400 9.500L7.800 14"];
const PHONE = ["M4.500 1.800h7a1 1 0 011 1v10.400a1 1 0 01-1 1h-7a1 1 0 01-1-1V2.800a1 1 0 011-1z", "M7 12h2"];
const BOLT = ["M9 2L4 9h4l-1 5 5-7H8z"];
const USERS = ["M6 3.300a2.200 2.200 0 100 4.400 2.200 2.200 0 000-4.400z", "M2 13c.4-2.400 2-3.500 4-3.500s3.600 1.100 4 3.500", "M11.200 4.300a1.700 1.700 0 110 3.400", "M11.500 9.600c1.400.2 2.200 1.200 2.500 3"];
const HOME = ["M2.500 7.500L8 3l5.500 4.500V13a.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5z", "M6.500 13.500v-4h3v4"];
const KEY = ["M5.500 8a2.500 2.500 0 100 5 2.500 2.500 0 000-5z", "M7.500 9L13 3.500M11 5.500L12.500 7"];
const GLOBE = ["M8 2.500a5.500 5.500 0 100 11 5.500 5.500 0 000-11z", "M2.500 8h11M8 2.500c2 2 2 9 0 11M8 2.500c-2 2-2 9 0 11"];
const LOCK = ["M3.500 7h9v6.500h-9z", "M5.500 7V5a2.500 2.500 0 015 0v2"];
const MAIL = ["M2 3.500h12v9H2z", "M2.500 4.500L8 9l5.500-4.500"];
const SERVER = ["M2.500 3h11v4h-11z", "M2.500 9h11v4h-11z", "M5 5h.01M5 11h.01"];
const DRIVE = ["M5.500 2.500h5l3 5.500-2.500 4.500h-6L2.500 8z"];
const DESKTOP = ["M2 3h12v8H2z", "M6 13.500h4M8 11v2.500"];

const KEYS: Record<string, StepLook> = {
  ai: L(SPARK, "#9A8CFF", "#5B5BD6"), interview: L(BRIEF, "#F7C25E", "#E08A1E"), sessions: L(CHAT, "#7DBBFF", "#3B7DE0"), folders: L(FOLDER, "#7CC4F5", "#3C9BD8"),
  chrome: L(CHROME, "#F47B6B", "#E0A82E"), phone: L(PHONE, "#5AD8BC", "#1F9E8A"), win: L(BOLT, "#FFDC7A", "#F2A31B"), team: L(USERS, "#A99CFF", "#6C57E6"),
  org: L(HOME, "#6CC2AE", "#2F7F70"), space_ai: L(KEY, "#BE9BFF", "#7A4FE0"), workspace: L(GLOBE, "#7BB0FF", "#3F6FE0"), sign_in: L(LOCK, "#8A90A0", "#454A57"),
  people: L(USERS, "#FFA3C0", "#E0568A"), invites: L(MAIL, "#86CBF8", "#3C7BD8"), agents: L(SERVER, "#AE9BFF", "#5B5BD6"), shared: L(DRIVE, "#FFD07A", "#E08A1E"),
  mine: L(MAIL, "#7DBBFF", "#3B7DE0"), apps: L(DESKTOP, "#5AD8BC", "#1F9E8A"), personal: L(HOME, "#9A8CFF", "#5B5BD6"),
};
const FALLBACK = L(SPARK, "#9A8CFF", "#5B5BD6");

/** `agents` means "meet them" for a member and "set up where they run" for an owner: the look is the same tile either way. */
export const stepLook = (_flow: FlowKind, key: string): StepLook => (key === "agents" && _flow === "member" ? L(CHAT, "#FFA3C0", "#E0568A") : KEYS[key] ?? FALLBACK);
