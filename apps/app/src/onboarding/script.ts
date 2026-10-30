// The scripted Assistant: the words for each step when no AI account is connected yet (a person who skipped it, or a member with none). The cards are the same real cards the
// live Assistant shows, so a step works with or without AI; only the conversation is pre-written. Plain, industry-neutral words.
import type { CardKind, FlowKind } from "./flow.ts";

export interface ScriptLine { role: "assistant"; text: string }
export interface ScriptStep { lines: readonly string[]; /** the preview on the right says what the step sets up */ preview: string; skipHint: string }

const S: Partial<Record<CardKind, ScriptStep>> = {
  connect_ai: { lines: ["Connect an AI account to talk to me. Until then I can walk you through each step with these cards.", "Sign in with Claude, ChatGPT or Grok, or paste an API key. A key goes straight into your Vault. I never see it."], preview: "Your AI account, kept in your Vault", skipHint: "You can add it later from the checklist." },
  interview: { lines: ["Tell me how you like to work. A few short answers are enough, and I keep them in your own memory.", "What do you do, which tools do you use every day, and how should I talk to you?"], preview: "Saved to your memory, editable any time", skipHint: "Skip it and I will learn as we go." },
  import_sessions: { lines: ["Vyre can bring in your Claude Code and Codex sessions found on this computer, so your history is here from the first day.", "You choose which ones. Nothing is imported until you confirm."], preview: "", skipHint: "You can import later from Settings." },
  local_folders: { lines: ["Pick the folders on this computer you want Vyre to see. They stay on this computer unless you share them."], preview: "Folders Vyre may read", skipHint: "Add folders later from Files." },
  chrome: { lines: ["The Chrome extension fills passwords from your Vault and lets agents work in your browser. Chrome needs three clicks from you."], preview: "", skipHint: "Install it later from the Vault." },
  phone: { lines: ["Scan this code with your phone to pair it, or open the link on the phone. The code works once and expires."], preview: "A pairing code for your phone", skipHint: "Pair a phone later from Settings." },
  first_win: { lines: ["Let us set one useful routine running, for example a short morning summary. You can change or stop it any time."], preview: "A routine you can see running", skipHint: "Set one up later from Automations." },
  bridge_team: { lines: ["When you are ready to work with other people, create a Team Space. It has its own Vault and memory. Nothing is copied from this Space unless you choose to."], preview: "Create a Team Space", skipHint: "You can add a team any time from the Space switcher." },
  org: { lines: ["Name your Space, then start blank or pick a Kit."], preview: "", skipHint: "Fill this in later from the Console." },
  space_ai: { lines: ["Choose the AI for this Space. You can use your own account here, and optionally add a shared key for everyone."], preview: "Who pays for the Space's AI", skipHint: "Set it later from the Console." },
  google_microsoft: { lines: ["Connect Google Workspace or Microsoft 365. I will give you the admin steps one at a time, with secure fields for keys and a live test at the end."], preview: "Connection status", skipHint: "Connect later from the Console." },
  sign_in_domain: { lines: ["Let people sign in with their work account for your domain, inside the same app."], preview: "Sign-in for your domain", skipHint: "Turn it on later from the Console." },
  directory: { lines: ["Import your directory, tick the people to bring in and give each a role. Accounts are made for the ones you pick."], preview: "People and roles", skipHint: "Add people later from Members." },
  invites: { lines: ["I draft an invite for each person. Nothing is sent until you approve it."], preview: "Invites waiting for your approval", skipHint: "Invite people later from Members." },
  agents: { lines: ["Your Kit comes with agents. Choose which to switch on and which computers run them."], preview: "Agents and the computers that run them", skipHint: "Set them up later from Agents." },
  shared_data: { lines: ["Share folders from Drive or SharePoint, bring in records from a sheet, and put shared logins in the Vault."], preview: "Shared folders, records and logins", skipHint: "Add shared data later." },
  team_win: { lines: ["Pick one thing your team does every week and let an agent take the first pass."], preview: "A team routine you can see running", skipHint: "Pick one later from Automations." },
};

const MEMBER: Partial<Record<CardKind, ScriptStep>> = {
  own_data: { lines: ["Your mail, calendar and files from your work account are already here, and only you can see them."], preview: "Your own data, mirrored", skipHint: "Nothing to do here." },
  apps: { lines: ["You can keep working in the browser. When you want them, the desktop app, the phone app and the Chrome extension are one click each."], preview: "Apps for this Space", skipHint: "Get them later from Settings." },
  meet_agents: { lines: ["Here are the team's agents and what each one does. You can ask any of them for help."], preview: "The team's agents", skipHint: "Meet them later from Agents." },
  optional_personal: { lines: ["You can also keep a Personal Space on this computer, separate from this team. It has its own Vault and memory."], preview: "A Personal Space on this computer", skipHint: "You can make one any time from the Space switcher." },
};

export function scriptFor(card: CardKind, flow: FlowKind): ScriptStep {
  const base = (flow === "member" ? MEMBER[card] : undefined) ?? S[card];
  return base ?? { lines: ["This step has no words yet."], preview: "", skipHint: "You can skip it." };
}

/** The Assistant opens with one greeting that names where the person is. */
export function greeting(flow: FlowKind, spaceName: string): string {
  return flow === "personal" ? `Welcome. This is your Personal Space, on this computer. I will help you set it up, one step at a time.`
    : flow === "team" ? `Welcome to ${spaceName}. You own it, so let us set it up for your team. Every step can wait.`
    : `Welcome to ${spaceName}. A few quick steps and you are ready to work here. Every step can wait.`;
}
