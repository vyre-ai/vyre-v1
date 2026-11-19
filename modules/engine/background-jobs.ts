// A long command the model asked to leave running (agent/src/tools/call.ts BackgroundPort), as a node of the Run tree (r42-runtime). The node is made when the call outlives its grace, holds a lease that this process
// keeps alive while it waits for the call, and ends when the call does. If this server dies the lease runs out and the sweep ends the node as failed (policy onLost: fail), saying the command may still be running in its
// tab: the process lives in tmux, only our wait for it is gone. Nothing here runs a command or touches a tab.
import type { BackgroundPort } from "../../agent/src/tools/call.ts";
import { BACKGROUND_GRACE_MS } from "../../agent/src/tools/call.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;
export const BEAT_MS = 5_000;

export function createBackgroundPort(
  h: { call: Call; log?: ((msg: string, attrs?: Record<string, unknown>) => void) | undefined },
  holder: string,
  graceMs: number = BACKGROUND_GRACE_MS,
): BackgroundPort & { running(): number } {
  const beats = new Map<string, ReturnType<typeof setInterval>>();
  const attempts = new Map<string, number>(); // the attempt this process claimed, named in its moves
  return {
    graceMs,
    running: () => beats.size,
    async begin(ctx, t) {
      const started = (await h.call("runs.node.start", {
        kind: "terminal",
        name: "A command in the terminal",
        owner: ctx.asker,
        ...(ctx.thread.threadId ? { threadId: ctx.thread.threadId, parentThread: ctx.thread.threadId } : {}),
        whoKind: "agent",
        whoId: ctx.agentId,
        origin: { background: true, tool: t.name },
        policy: { onLost: "fail" },
        ...(ctx.turnId && ctx.callId ? { idemKey: `bg:${ctx.turnId}:${ctx.callId}` } : {}),
      })) as { node: { id: string; status: string; attempt: number } };
      const id = started.node.id;
      const got = (await h.call("runs.node.claim", { runId: id, holder })) as { node?: { attempt?: number } };
      attempts.set(id, got.node?.attempt ?? started.node.attempt);
      if (!got.node && started.node.status !== "running") {
        // no node is left queued for ever when the command is simply waited for instead
        await h
          .call("runs.node.move", { runId: id, attempt: started.node.attempt, to: "stopped", why: "stopped", stopReason: "not_started" })
          .catch(() => undefined);
        return null;
      }
      const timer = setInterval(() => {
        void h
          .call("runs.node.beat", { runId: id, holder })
          .then((r) => {
            if ((r as { held?: boolean }).held === false) stop(id); // stopped by a person, or the lease was lost: no more beats
          })
          .catch(() => undefined);
      }, BEAT_MS);
      timer.unref?.();
      beats.set(id, timer);
      return { runId: id };
    },
    async end(runId, outcome) {
      stop(runId);
      const attempt = attempts.get(runId) ?? 1;
      attempts.delete(runId);
      try {
        await h.call("runs.node.move", {
          holder,
          attempt,
          runId,
          to: outcome.held ? "stopped" : outcome.ok ? "succeeded" : "failed",
          why: outcome.held ? "stopped" : outcome.ok ? "done" : "failed",
          ...(outcome.held ? { stopReason: "held" } : {}),
          summary: outcome.summary,
          ...(outcome.ok || outcome.held
            ? {}
            : { error: { code: outcome.code ?? "failed", message: outcome.summary } }),
        });
      } catch (e) {
        // already over (a person stopped it): the command's own end changes nothing
        h.log?.("a background command ended after its node did", {
          runId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
  };
  function stop(id: string): void {
    const t = beats.get(id);
    if (t) clearInterval(t);
    beats.delete(id);
  }
}
