// Services beyond static (r42-sites-run, slice 5): a Node, Python or Docker worker that has no port, and a web process that must stay up.
// Explicit state machine for one service, with the crash-loop backoff. Pure: time comes in as an argument, nothing here starts a container; supervisor.ts does, from the answers.
//   stopped   nobody wants it running (never started, or a person stopped it)
//   starting  a container was asked for and has not yet stayed up for READY_AFTER_MS (a worker has no port to answer on: it is ready when it stays up)
//   running   up and past the ready time
//   backoff   it exited and will be started again at `restartAt`
//   failed    it crashed too often: automatic restarts stopped, one sentence says why, a person's Restart clears it

export type ServiceState = "stopped" | "starting" | "running" | "backoff" | "failed";
export type ServiceKind = "web" | "worker";

export interface Service {
  id: string;
  siteId: string;
  name: string;
  kind: ServiceKind;
  state: ServiceState;
  /** when the current container started */
  startedAt?: number | undefined;
  /** when the next start is due, in backoff */
  restartAt?: number | undefined;
  /** crashes in a row without once staying up for STABLE_MS */
  streak: number;
  /** the times of recent crashes, newest last, within LOOP_WINDOW_MS */
  crashes: number[];
  lastExit?: { at: number; code: number; oom?: boolean };
  /** one plain sentence, set for backoff and failed */
  note?: string | undefined;
}

export const READY_AFTER_MS = 10_000;
/** A container that stayed up this long was healthy: the streak starts again. */
export const STABLE_MS = 60_000;
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
export const LOOP_WINDOW_MS = 10 * 60_000;
export const LOOP_MAX = 8;

export const fresh = (id: string, siteId: string, name: string, kind: ServiceKind): Service => ({
  id,
  siteId,
  name,
  kind,
  state: "stopped",
  streak: 0,
  crashes: [],
});

export const backoffMs = (streak: number): number =>
  Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, streak - 1));

export type ServiceEvent =
  /** a person or a deploy wants it running */
  | { t: "want"; at: number }
  /** a container was started */
  | { t: "spawned"; at: number }
  /** the container stopped by itself or was killed (code 137 with oom for the memory cap) */
  | { t: "exited"; at: number; code: number; oom?: boolean }
  /** time passes: promotes starting to running, backoff to a start */
  | { t: "tick"; at: number }
  /** a person stopped it */
  | { t: "stop"; at: number }
  /** a person pressed Restart: clears backoff and failed */
  | { t: "restart"; at: number };

export type ServiceOut = {
  service: Service;
  /** what the supervisor must do now: restart is kill then start, and the exit it causes is not sent back as a crash */
  act: "none" | "start" | "kill" | "restart";
};

const why = (code: number, oom?: boolean): string =>
  oom
    ? "It ran out of memory."
    : code === 0
      ? "It finished and exited."
      : `It stopped with an error (exit code ${code}).`;

/** The one place a service changes. Events that do not apply in the current state change nothing (a late "exited" after a stop, a second "spawned"). */
export function advance(s: Service, ev: ServiceEvent): ServiceOut {
  const keep = (service: Service, act: ServiceOut["act"] = "none"): ServiceOut => ({ service, act });
  switch (ev.t) {
    case "want":
      if (s.state === "stopped") return keep({ ...s, state: "starting", note: undefined }, "start");
      return keep(s);
    case "restart":
      // a clean slate: no streak, no history, started at once
      return keep(
        {
          ...s,
          state: "starting",
          streak: 0,
          crashes: [],
          startedAt: undefined,
          restartAt: undefined,
          note: undefined,
        },
        s.state === "running" || s.state === "starting" ? "restart" : "start",
      );
    case "stop":
      return keep(
        { ...s, state: "stopped", startedAt: undefined, restartAt: undefined, note: undefined },
        s.state === "running" || s.state === "starting" ? "kill" : "none",
      );
    case "spawned":
      if (s.state === "starting") return keep({ ...s, startedAt: ev.at, restartAt: undefined });
      return keep(s);
    case "tick": {
      if (s.state === "starting" && s.startedAt !== undefined && ev.at - s.startedAt >= READY_AFTER_MS)
        return keep({ ...s, state: "running" });
      if (s.state === "running" && s.startedAt !== undefined && ev.at - s.startedAt >= STABLE_MS && s.streak > 0)
        return keep({ ...s, streak: 0 });
      if (s.state === "backoff" && s.restartAt !== undefined && ev.at >= s.restartAt)
        return keep({ ...s, state: "starting", startedAt: undefined, restartAt: undefined }, "start");
      return keep(s);
    }
    case "exited": {
      if (s.state !== "starting" && s.state !== "running") return keep(s);
      const stable = s.startedAt !== undefined && ev.at - s.startedAt >= STABLE_MS;
      const streak = stable ? 1 : s.streak + 1;
      const crashes = [...s.crashes.filter((t) => ev.at - t < LOOP_WINDOW_MS), ev.at];
      const lastExit = { at: ev.at, code: ev.code, ...(ev.oom ? { oom: true } : {}) };
      if (crashes.length >= LOOP_MAX)
        return keep({
          ...s,
          state: "failed",
          streak,
          crashes,
          lastExit,
          startedAt: undefined,
          restartAt: undefined,
          note: `${why(ev.code, ev.oom)} It stopped ${crashes.length} times in ${Math.round(LOOP_WINDOW_MS / 60_000)} minutes, so it is not restarting by itself. Fix it and press Restart.`,
        });
      const wait = backoffMs(streak);
      return keep({
        ...s,
        state: "backoff",
        streak,
        crashes,
        lastExit,
        startedAt: undefined,
        restartAt: ev.at + wait,
        note: `${why(ev.code, ev.oom)} Starting again in ${Math.max(1, Math.round(wait / 1000))} seconds.`,
      });
    }
  }
}

/** A worker is ready when it stays up; a web process is ready when it also answers (the caller checks the port and passes it). */
export function ready(s: Service, answers: boolean): boolean {
  if (s.state !== "running") return false;
  return s.kind === "worker" ? true : answers;
}

/** After the server restarts: containers the runner still has are adopted, services that should run but have no container are started. */
export function reconcile(
  services: readonly Service[],
  alive: ReadonlySet<string>,
  at: number,
): { id: string; ev: ServiceEvent }[] {
  const out: { id: string; ev: ServiceEvent }[] = [];
  for (const s of services) {
    const up = alive.has(s.id);
    if ((s.state === "starting" || s.state === "running") && !up)
      out.push({ id: s.id, ev: { t: "exited", at, code: 255 } });
    else if (s.state === "stopped" && up) out.push({ id: s.id, ev: { t: "stop", at } });
  }
  return out;
}
