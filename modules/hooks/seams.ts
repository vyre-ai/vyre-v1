// What the host binds into the Hooks module (lane l-hooks): the things only the engine side can do. Unbound (a unit test, a host without them) each answers "nothing happened" and no hook fails the work.
import type { CheckAnswer } from "../../lib/hooks.ts";

export interface Who { agentId: string; asker: string; threadId?: string }
export interface CommandResult { code: number | null; stdout: string; stderr: string; timedOut: boolean }
export interface PluginHook { pluginId: string; plugin: string; event: string; matcher: string; command: string; args: string[]; timeoutSec?: number }
export interface HostSeams {
  /** Run a command in the agent's own sandbox with the event as JSON on its standard input. */
  command(who: Who, h: { command: string; args?: string[]; timeoutSec: number }, event: unknown): Promise<CommandResult>;
  /** Run one hook a plugin brought (the existing sandboxed path). */
  plugin(who: Who, h: PluginHook, event: unknown): Promise<CommandResult>;
  /** The hooks the agent's plugins brought, for this asker. */
  pluginHooks(who: Who): Promise<PluginHook[]>;
  /** A small model reads the instruction against the event, on the asker's own AI account. Null: no account could answer. */
  check(who: Who, instruction: string, event: unknown, timeoutSec: number): Promise<CheckAnswer | null>;
  /** Call one capability as the agent acting for the asker, through the normal pipeline (access, the Gate, the audit). */
  action(who: Who, cap: string, input: unknown): Promise<unknown>;
}

const none = (): Promise<never> => Promise.reject(new Error("this host runs no hooks"));
export const hostSeams: HostSeams = { command: none, plugin: none, pluginHooks: () => Promise.resolve([]), check: () => Promise.resolve(null), action: none };

/** Bind (or, with null, unbind) what the host can do. */
export function bindHooks(h: Partial<HostSeams> | null): void {
  hostSeams.command = h?.command ?? none;
  hostSeams.plugin = h?.plugin ?? none;
  hostSeams.pluginHooks = h?.pluginHooks ?? (() => Promise.resolve([]));
  hostSeams.check = h?.check ?? (() => Promise.resolve(null));
  hostSeams.action = h?.action ?? none;
}
