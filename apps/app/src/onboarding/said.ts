// What the Assistant says on each step: one short sentence. Less text, so the cards and icons do the talking; longer help is on hover or when something fails.
import type { CardKind } from "./flow.ts";

export const SAID: Partial<Record<CardKind, string>> = {
  connect_ai: "Sign in to your AI.", interview: "Three quick ones.", import_sessions: "Found these on this computer.", local_folders: "Which folders?", chrome: "Add Vyre to Chrome.", phone: "Take Vyre with you.",
  first_win: "Pick one. I will run it now.", bridge_team: "Bring your team?", org: "Name your Space.", space_ai: "Which AI for the Space?", google_microsoft: "Connect your work accounts.",
  sign_in_domain: "Let people sign in with work.", directory: "Add your people.", invites: "Nothing sends until you say.", agents: "Where should they run?", shared_data: "What should everyone reach?",
  team_win: "Pick one for the team.", own_data: "Already here, only yours.", apps: "Get Vyre anywhere.", meet_agents: "Say hello.", optional_personal: "A Personal Space too?",
};
/** A hover note on the lock beside a title, where the step handles a secret. */
export const LOCK: Partial<Record<CardKind, string>> = {
  connect_ai: "Your sign-in goes into your Vault. The Assistant never sees it.", space_ai: "Nothing crosses Spaces unless you say so.", google_microsoft: "Secrets go into your Vault, restricted. The Assistant never sees them.",
};
export const saidFor = (card: CardKind, welcome: string | null): string => welcome ?? SAID[card] ?? "";

/** What the Assistant chat under a step offers: one short line and one or two things to ask. A step left out shows no chat, because the card already says it all (signing in, the
 * interview, pairing a phone). Plain, industry-neutral words; a suggestion fills the composer and is sent only when the person sends it. */
export interface StepAsk { prompt: string; suggestions: readonly string[] }
export const ASK: Partial<Record<CardKind, StepAsk>> = {
  import_sessions: { prompt: "Ask me which sessions to bring in.", suggestions: ["Which sessions are worth importing?", "Where do imported sessions go?"] },
  local_folders: { prompt: "Ask me which folders to add.", suggestions: ["Which folders should I add?", "Who can see these folders?"] },
  chrome: { prompt: "Ask me what the extension does.", suggestions: ["What can agents do in Chrome?"] },
  first_win: { prompt: "Ask me for a routine that fits your week.", suggestions: ["Suggest a routine for my week"] },
  bridge_team: { prompt: "Ask me how a Team Space works.", suggestions: ["What stays private when I add a team?"] },
  org: { prompt: "Ask me which Kit fits your work.", suggestions: ["Which Kit fits us?"] },
  google_microsoft: { prompt: "Ask me about any admin step.", suggestions: ["What do I need before I start?"] },
  sign_in_domain: { prompt: "Ask me how work sign-in works.", suggestions: ["What changes for my team?"] },
  directory: { prompt: "Ask me which role to give people.", suggestions: ["What can each role do?"] },
  agents: { prompt: "Ask me where agents should run.", suggestions: ["Which computer should run them?"] },
  shared_data: { prompt: "Ask me what to share with everyone.", suggestions: ["What should the team reach?"] },
  team_win: { prompt: "Ask me for a routine your team would use.", suggestions: ["Suggest a weekly team routine"] },
  meet_agents: { prompt: "Ask me what each agent does.", suggestions: ["Who should I ask first?"] },
};
export const askFor = (card: CardKind): StepAsk | null => ASK[card] ?? null;

/** Why Continue waits, said beside it while it does: what the step needs, in a few words. Every step can also be skipped for now. */
export const WAIT: Partial<Record<CardKind, string>> = {
  connect_ai: "Sign in or add a key first", interview: "Answer the questions first", import_sessions: "Tick sessions to import", local_folders: "Add a folder first",
  chrome: "Add the extension first", phone: "Pair your phone first", first_win: "Pick a routine first", bridge_team: "Create a Team Space first",
  org: "Name your Space first", space_ai: "Add a key or sign in first", google_microsoft: "Finish the setup in the Console first", sign_in_domain: "Set up work sign-in first",
  directory: "Invite people first", invites: "Make an invite first", own_data: "Open it to look", apps: "Open it to look", meet_agents: "Open it to look",
};
export const waitFor = (card: CardKind): string => WAIT[card] ?? "Nothing to do here yet";
