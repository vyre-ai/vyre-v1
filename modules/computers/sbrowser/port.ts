// The Space browser as a port (owner decision 6 Nov, DESIGN-agent-workspaces.md): one browser service per Space host, a persistent Chrome profile per agent and per person's Assistant. The module asks this
// port; the server binds the Docker adapter (docker.ts). No process starts and no socket opens here. A profile is named by the agent's id: its cookies, logins and tabs are its own.
export type BrowserAnswer = Record<string, unknown>;

export interface ProfileRow {
  profileId: string;
  running: boolean;
  tabs: number;
  busy: boolean;
  /** A person has the controls. */
  takeover: boolean;
  /** Which person. */
  takeoverBy?: string;
  /** People watching its live view. */
  viewers: number;
  lastActiveAt: number;
  held: number;
  paused: boolean;
  /** Vyre for Chrome in the profile, paired with the Space as the agent: the extensions connected, whether it said hello, and whether the Space opened the browser to the agent's Space. */
  bridge?: { connected: number; hello: boolean; optin: boolean };
}

/** A finished download in a profile's folder inside the browser service, not yet in the agent's Files. */
export interface DownloadRow { name: string; size: number; at: number }

export interface BrowserToolCall {
  profileId: string;
  /** The capability's mcpName: chrome_open, chrome_click ... */
  tool: string;
  args: Record<string, unknown>;
  timeoutMs: number;
  /** `person` is the person at the controls acting through the live view: browserd lets it through a takeover that holds the agent's tools. */
  by?: "person";
  /** Who the browser belongs to, for its start page: the agent's name and its face (an SVG drawn once, sent when it changes). */
  agent?: { name: string; faceSvg?: string };
  /** The Space this agent works in: Vyre for Chrome in the profile is paired with it, as the agent, so Vault logins fill. */
  space?: string;
  /** The Vault channel of this profile's agent for #Handle.field in the call: held by browserd in memory, for this profile only. */
  fill?: { url: string; token: string };
}

export interface SpaceBrowser {
  /** Can this host run it at all (the container runtime answers)? When not, an agent keeps browsing where it did before (its own computer, or the person's Chrome). Cheap: the router asks at most every 15 seconds. */
  available(): Promise<boolean>;
  /** One browser tool for one profile. Starts the service and the profile's browser when they are not running. Throws an error with a `code` (timeout, paused, not_found, bad_input, held, unavailable). */
  tool(a: BrowserToolCall): Promise<BrowserAnswer>;
  /** Finished downloads waiting in the profile's folder (needs no running browser). */
  downloads(profileId: string): Promise<DownloadRow[]>;
  downloadRead(profileId: string, name: string): Promise<Uint8Array>;
  /** The file is in Files: it leaves the browser service. */
  downloadAck(profileId: string, name: string): Promise<void>;
  takeover(a: { profileId: string; personId: string }): Promise<void>;
  giveBack(profileId: string): Promise<void>;
  screenshot(profileId: string): Promise<{ bytes: Uint8Array; width: number; height: number }>;
  /** Where the live view of a profile is served from, for a ticket the viewer presents. `ws` is browserd's own WebSocket address on the machine that runs it, for the host's relay, never for a viewer. */
  stream(a: { profileId: string }): Promise<{ transport: "mjpeg"; url: string; ws?: string; width?: number; height?: number }>;
  /** Replace the profile's Chrome data with a tar whose root entry is the folder `chrome` (the old computer's Chrome user-data). The profile's browser is stopped first. */
  importChrome(profileId: string, tar: Uint8Array): Promise<{ bytes: number }>;
  /** The sites the profile holds cookies for (starts its browser when it is asleep). */
  sessions(profileId: string): Promise<Array<{ site: string; since: number; lastSeen: number }>>;
  /** Clear one site's cookies and storage in the profile. */
  signOut(profileId: string, site: string): Promise<boolean>;
  /** The browser of the profile stops; the folder stays. */
  stop(profileId: string): Promise<void>;
  /** The agent is gone: the browser stops and the folder is deleted. */
  forget(profileId: string): Promise<void>;
  profiles(): Promise<{ profiles: ProfileRow[]; maxRunning: number }>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

let bound: SpaceBrowser | null = null;
/** The host binds the Space browser here; unbound, the chrome_* tools keep using the agent's own computer (or the person's Chrome). */
export function bindSpaceBrowser(b: SpaceBrowser | null): void { bound = b; }
export const spaceBrowser = (): SpaceBrowser | null => bound;
