// The sign-in card data of Settings > Sign-in and devices for the open Space: what this person's sign-in is here. The password and GitHub are the person's own; the authenticator app and passkeys are
// theirs in this Space; the second-factor floor and single sign-on are the Space's; devices are the ones signed in here. Each comes from one read (identity.security.get, identity.sign_in_options and
// devices.mine); a Space is shown only when its reads answer, so a card never states what the device did not hear.
import type { SettingsData } from "../../places/settings/data.tsx";
import type { ShellRuntime } from "./runtime.tsx";

type Call = ShellRuntime["call"];
const day = (t: number): string => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export async function loadSecurity(call: Call, space: { id: string; kind: string }, _now: number = Date.now()): Promise<NonNullable<SettingsData["security"]>> {
  const [mine, options, devices] = await Promise.all([call("identity.security.get", {}), call("identity.sign_in_options", {}), call("devices.mine", {})]) as [
    { passwordChangedAt: number; github?: string; totp: boolean; passkeys: string[] },
    { secondFactorRequired: boolean; sso: Array<{ title: string }> },
    { devices: unknown[] },
  ];
  return {
    account: { passwordChanged: day(mine.passwordChangedAt), github: mine.github ?? null },
    spaces: {
      [space.id]: {
        totp: mine.totp, passkeys: mine.passkeys,
        floor: options.secondFactorRequired ? "Required" : "Not required", floorBy: "your Space's admins",
        sso: options.sso[0]?.title ?? "", devices: devices.devices.length,
      },
    },
  };
}
