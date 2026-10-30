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
