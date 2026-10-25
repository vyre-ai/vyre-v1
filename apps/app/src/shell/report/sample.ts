// Sample deps for the sheet's mount and tests: a window that has done 20 things, a server that answers, an outbox in memory.
import { Captures } from "./ring.ts";
import { createMemoryOutbox } from "./outbox.ts";
import type { Outbox } from "./outbox.ts";
import type { ReportDeps, SubmitResult } from "./controller.ts";
import type { SubmitIn } from "./bundle.ts";

export const PLACE_NAMES: Readonly<Record<string, string>> = {
  home: "Home", chats: "Chats", inbox: "Inbox", records: "Records", files: "Files", apps: "Apps", automations: "Automations", vault: "Vault", settings: "Settings",
};

/** The same ids the prototype sheet shows: tr_7a3f00 and every 977 after it. */
export function sampleCaptures(extraActions = 0): Captures {
  const c = new Captures();
  for (let i = 0; i < 20 + extraActions; i++) c.noteAction("tr_" + (0x7a3f00 + i * 977).toString(16));
  const t0 = Date.UTC(2026, 9, 24, 9, 30);
  c.noteEvent({ type: "task.assigned", at: t0, traceId: "tr_7a3f00" });
  c.noteEvent({ type: "notification.delivered", at: t0 + 60000 });
  c.noteEvent({ type: "chat.message_posted", at: t0 + 120000, traceId: "tr_7a43d1" });
  c.writeLog("info", "sync ok", t0);
  return c;
}

export interface SampleOptions {
  online?: boolean;
  policy?: "on" | "ask" | "off";
  captures?: Captures;
  outbox?: Outbox;
  failSubmit?: boolean;
}

export interface SampleRun {
  deps: ReportDeps;
  captures: Captures;
  outbox: Outbox;
  submitted: SubmitIn[];
  sentToVyre: string[];
  /** Flip the connection the deps report. */
  setOnline(v: boolean): void;
  setPolicy(v: "on" | "ask" | "off"): void;
}

export function createSampleDeps(o: SampleOptions = {}): SampleRun {
  const captures = o.captures ?? sampleCaptures();
  const outbox = o.outbox ?? createMemoryOutbox();
  let online = o.online ?? true;
  let policy = o.policy ?? "on";
  let n = 0;
  const submitted: SubmitIn[] = [];
  const sentToVyre: string[] = [];
  const deps: ReportDeps = {
    snapshot: () => captures.snapshot(),
    versions: () => ({ app: "1.0.0", server: "1.0.0", device: "Mac · Chrome" }),
    online: () => online,
    policy: () => policy,
    submit: async (input): Promise<SubmitResult> => {
      if (o.failSubmit) throw new Error("server unavailable");
      submitted.push(input);
      n += 1;
      return { reportId: `rpt_${n}`, taskId: `tsk_${n}`, sentToVyre: policy === "on" };
    },
    sendToVyre: async (id) => { sentToVyre.push(id); return { issueNumber: 1234 }; },
    issueNumber: async () => 1234,
    captureScreenshot: async () => "fil_shot1",
    uploadLog: async () => "fil_log1",
    placeName: (p) => PLACE_NAMES[p] ?? p,
    windowSize: () => ({ width: 1280, height: 800 }),
    outbox,
    now: () => Date.UTC(2026, 9, 24, 10, 0),
    newId: () => `t${n}`,
  };
  return { deps, captures, outbox, submitted, sentToVyre, setOnline: (v) => { online = v; }, setPolicy: (v) => { policy = v; } };
}
