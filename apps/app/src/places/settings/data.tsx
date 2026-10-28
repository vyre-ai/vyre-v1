// Settings data: the one context every page reads. Lists are live queries over the local copy; every change goes through `call`, one capability per action, and is saved as it is made
// (quiet Saved, Undo where the capability returns the previous value). The shell supplies the value; the place never decides how a thing opens.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../client/src/index.ts";

export interface SpaceTile { id: string; name: string; addr: string; kind: "personal" | "team"; role: string; needsYou: number; current: boolean }

export interface SettingsNav {
  openVault(): void;
  openConsole(): void;
  openSpace(id: string): void;
  /** Provider or mailbox sign-in lives in the Vault or the Connections flow. */
  connect(kind: "mailbox" | "calendar"): void;
  /** The shell's file picker for a profile photo: the file id, or null when nothing was chosen. */
  choosePhoto(): Promise<string | null>;
  /** Applies a skin to the window at once, before it is saved. */
  previewSkin?(skinId: string | null): void;
  /** Starts a sign-in change that needs its own flow (password, authenticator app, passkey, GitHub) for a Space. The shell opens it; the page only asks. */
  manageSecurity?(kind: "password" | "totp-on" | "totp-off" | "passkey" | "github-on" | "github-off", spaceId: string): void;
}

/** What one Space asks of this person's sign-in: its second factor, passkeys, the floor its admins set and single sign-on. */
export interface SpaceSecurity { totp: boolean; passkeys: readonly string[]; floor: string; floorBy: string; sso: string; devices: number }
/** The sign-in that is the same for every Space: the password and a linked GitHub account. */
export interface AccountSecurity { passwordChanged: string; github: string | null }

export interface SettingsData {
  sessionImporter?: import("../../../../../client/src/session-import/desktop.ts").SessionImporter | undefined;
  continueSession?(conversationId: string): Promise<void>;
  screens: ScreenHooks;
  call(cap: string, input: unknown): Promise<unknown>;
  me: { id: string; name: string };
  /** The open Space. */
  space: { id: string; name: string };
  /** Every Space this person is in, for the Spaces page and the per-Space switches. */
  spaces: readonly SpaceTile[];
  /** A capability's answer when it is already on the device, so a page paints at once; the page asks `call` otherwise. */
  peek?(cap: string, input: unknown): unknown;
  name(id: string): string;
  nav: SettingsNav;
  clock(): { now: number; offsetMin: number };
  /** The sign-in the person has in each Space, as the device holds it. */
  security?: { account: AccountSecurity; spaces: Readonly<Record<string, SpaceSecurity>> };
}

const Ctx = createContext<SettingsData | null>(null);

export function SettingsDataProvider({ value, children }: { value: SettingsData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useSettingsData(): SettingsData {
  const v = useContext(Ctx);
  if (!v) throw new Error("Settings needs a SettingsDataProvider above it");
  return v;
}

/** A live screen query (generated/screens.ts). Re-subscribes only when the screen, query or state changes. */
export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useSettingsData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

export const PAGE = "settings.page";
export const SEARCH = "settings.search";
export const NOTIFICATIONS = "notifications.settings";
export const MODELS = "settings.models-usage";
export const CONNECTIONS = "mail.connections";
export const DEVICES = "devices.mine";
export const SPACES = "spaces.settings_index";
export const COPY = "settings.copy_profile";
export const KIT = "settings.kit";
