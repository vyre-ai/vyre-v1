// Installing an engine as soon as its account is connected: a Claude, Codex or Grok sign-in added in the Vault (provider.added) starts Vyre's install of that program on this computer in the background
// when the program is not here, so the first chat on the new account does not wait for a download. A turn that comes first waits for the same install (checkedOpen in runnable-account.ts).
import { PROGRAM_OF_PROVIDER, findProgram } from "./cli-programs.ts";
import type { NodeCliProbe } from "./cli-programs.ts";
import { engines } from "./engine-install.ts";
import type { EngineInstaller } from "./engine-install.ts";

export interface InstallOnConnectDeps {
  /** The installer. Default: this process's, when it has one. */
  installer?: Pick<EngineInstaller, "supported" | "ensure"> | null;
  probe?: NodeCliProbe;
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
}

/** Starts the install for the program a connected provider runs on, unless it is here already, has no build for this computer, or the installer is off. Answers the programs it started; never waits. */
export function installOnConnect(providerKey: string | undefined, d: InstallOnConnectDeps = {}): string[] {
  const program = providerKey !== undefined && Object.hasOwn(PROGRAM_OF_PROVIDER, providerKey) ? PROGRAM_OF_PROVIDER[providerKey] : undefined;
  const installer = d.installer === undefined ? engines() : d.installer;
  if (program === undefined || !installer || !installer.supported(program) || findProgram(program, d.probe) !== null) return [];
  installer.ensure(program).catch((e: unknown) => d.log?.("an engine could not be set up after its account was connected", { program, error: e instanceof Error ? e.message : String(e) }));
  return [program];
}
