// Windows only: the one-time sandbox setup row of This device. Renders nothing anywhere else. (The list of machines is the shared Machines component, apps/app/src/machines.)
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { WIN_SANDBOX, winSandboxRow } from "./computers-model.ts";
import type { WinSandboxPhase } from "./computers-model.ts";
import { Glyph, Section, SettingsRow, SmallButton } from "./ui.tsx";

type ShellInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
const shellInvoke = (): ShellInvoke | undefined => (globalThis as { __TAURI__?: { core?: { invoke?: ShellInvoke } } }).__TAURI__?.core?.invoke;

/** Windows only: "Set up the Windows sandbox for team chats", once, while WSL is off (desktop shell winsandbox.rs). Renders nothing anywhere else. */
export function WindowsSandboxRow(): ReactElement | null {
  const [phase, setPhase] = useState<WinSandboxPhase>({ kind: "hidden" });
  useEffect(() => {
    const invoke = shellInvoke();
    if (!invoke) return;
    let live = true;
    void invoke("windows_sandbox_state").then((s) => { if (live) setPhase(winSandboxRow(s as { supported: boolean; on: boolean })); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  if (phase.kind === "hidden") return null;
  const setup = (): void => {
    const invoke = shellInvoke();
    if (!invoke) return;
    setPhase({ kind: "asking" });
    void invoke("setup_windows_sandbox").then(() => setPhase({ kind: "restart" }), (e: unknown) => setPhase({ kind: "failed", why: typeof e === "string" ? e : "Windows did not turn WSL on." }));
  };
  const sub = phase.kind === "restart" ? WIN_SANDBOX.restart : phase.kind === "failed" ? phase.why : undefined;
  return (
    <Section title="Windows">
    <SettingsRow
      id="computer.winsandbox" label={WIN_SANDBOX.label} lead={<Glyph name="shield" />} help={WIN_SANDBOX.help} {...(sub ? { sub } : {})}
      control={phase.kind === "restart" ? undefined : <SmallButton label={phase.kind === "asking" ? "Waiting for Windows" : "Set up"} testID="winsandbox-setup" onPress={setup} />}
    />
    </Section>
  );
}
