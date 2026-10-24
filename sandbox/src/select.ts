// Which sandbox a CLI engine runs in (ARCH 6.6 table): the person's container on the Space host; Seatbelt on a Mac; bwrap on Linux; on Windows bwrap inside WSL2, or the person's container on
// the server. Windows is a client, never a host. API drivers do not use a sandbox: they run in the daemon.
import { SandboxError } from "./types.ts";
import type { SandboxKind } from "./types.ts";

export interface Where {
  /** 'host': a turn the Space server runs (group chats, routines, agent work). 'device': a private chat on the person's own computer. */
  placement: "host" | "device";
  platform: "darwin" | "linux" | "win32";
  /** Windows only: WSL2 with bubblewrap is installed. */
  wsl?: boolean;
  hasDocker?: boolean;
  hasBwrap?: boolean;
}

export type Choice = { kind: SandboxKind; via?: "wsl" } | { kind: "server" };

/** `server` means: do not run it here, run it on the Space server in the person's container. */
export function chooseSandbox(w: Where): Choice {
  if (w.placement === "host") {
    if (!w.hasDocker) throw new SandboxError("sandbox.unavailable", "the Space host needs Docker to run CLI engines");
    return { kind: "docker" };
  }
  if (w.platform === "darwin") return { kind: "seatbelt" };
  if (w.platform === "linux") {
    if (!w.hasBwrap) throw new SandboxError("sandbox.unavailable", "bubblewrap (bwrap) is not installed on this computer");
    return { kind: "bwrap" };
  }
  return w.wsl === true ? { kind: "bwrap", via: "wsl" } : { kind: "server" };
}
