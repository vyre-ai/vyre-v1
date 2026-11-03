// A Space's goals for screenshots and screen tests: "300 registrations for Lab 8" read from Luma, led by Lab Desk, in each state the page draws (active with a held send, stuck, budget at
// 80%, paused at the budget, missed, done, a draft), plus two more goals for the sidebar. `goalsCall` answers the goals capabilities and the tasks a waiting item reads.
import type { ActivityLine, Goal, GoalLine, GoalPageData, Reading, TaskLine, WaitLine } from "./model.ts";

export type SampleState = "active" | "stuck" | "budget" | "paused" | "missed" | "done" | "draft";
const HOUR = 3_600_000, DAY = 24 * HOUR;

export function sampleGoals(now: number, state: SampleState = "active"): { page: GoalPageData; lines: GoalLine[] } {
  const created = now - 5 * DAY;
  const value = state === "done" ? 301 : state === "missed" ? 268 : 212;
  const status = state === "budget" ? "waiting" : state === "active" ? "waiting" : state;
  const goal: Goal = {
    id: "gol_lab8", title: "300 registrations for Lab 8", outcome: "A full room for Lab 8", status,
    ...(state === "stuck" ? { statusReason: "No new registrations in 3 check-ins; 212 of 300 registrations since Mon 9:00. Waiting on: Approve: email to 1,240 Lab 7 attendees." } : state === "paused" ? { statusReason: "The budget is used: $25.10 of $25, 151 of 200 turns." } : state === "active" || state === "budget" ? { statusReason: "Approve: email to 1,240 Lab 7 attendees" } : {}),
    owner: "usr_irfad", leadAgentId: "agt_labdesk", deadline: state === "missed" || state === "done" ? now - 2 * HOUR : now + 3 * DAY + 8 * HOUR,
    ...(state === "missed" || state === "done" || state === "draft" || state === "paused" ? {} : { nextCheckinAt: now + 20 * HOUR }),
    progress: { value, target: 300, start: 96, percent: Math.round(((value - 96) / (300 - 96)) * 100), readAt: now - 4 * 60_000, tasksDone: state === "done" ? 5 : 3, tasks: 5 },
    projectId: "prj_lab8", updatedAt: now - 10 * 60_000,
    finish: { kind: "number", line: "Luma registrations for Lab 8 reach 300", target: 300, unit: "registrations", source: { kind: "connection", label: "Luma, Lab 8 event" } },
    helpers: [{ kind: "agent", id: "agt_content" }, { kind: "person", id: "usr_aliza" }], recordIds: [], budget: { spendMicros: 25_000_000, turns: 200 },
    rhythm: { every: "day", at: "09:00" }, zone: "Asia/Karachi", quiet: { from: "22:00", to: "08:00" },
    permissions: [{ act: "post", target: "skool", label: "Post in the MLA AI Labs community", granted: true }, { act: "send", target: "mail.send", label: "Send email from the Lab template to Lab 8 registrants", granted: true }],
    rootTaskId: "tsk_root", folderId: "fld_goal", lastCheckinAt: now - 4 * HOUR, checkins: 4,
    spentMicros: state === "budget" ? 20_500_000 : state === "paused" ? 25_100_000 : state === "done" ? 14_800_000 : 4_100_000, turns: state === "budget" ? 164 : state === "paused" ? 151 : state === "done" ? 118 : 38,
    stuckAfter: 3, createdBy: "usr_irfad", createdAt: created,
    ...(state === "missed" ? { ended: "missed" as const, endedAt: now - 2 * HOUR, summary: "Got to 268 of 300 registrations (84%) by the deadline. 4 of 5 tasks done. Still open: Retarget the Lab 8 lead form. Used $18.20 of $25, 151 of 200 turns.",
      retro: { summary: "Reminders moved it most; the held email cost three days.", worked: ["Reminder to Lab 7 attendees: +41 in a day", "Newsletter and two community posts: +45"], didNot: ["The reminder waited on approval from Mon to Thu", "Retargeting started Wed, too late"] } } : {}),
    ...(state === "done" ? { ended: "done" as const, endedAt: now - 2 * HOUR, summary: "Reached 301 of 300 registrations (100%). 5 of 5 tasks done. Used $14.80 of $25, 118 of 200 turns.",
      retro: { summary: "Reached a day early.", worked: ["Reminder to Lab 7 attendees: +41 in a day, the biggest single step", "Newsletter and two community posts: +52", "Reels and retargeting: +23"], didNot: [] } } : {}),
  };
  const tasks: TaskLine[] = [
    { taskId: "tsk_rem", key: "VY-311", title: "Remind Lab 7 attendees who have not registered", state: state === "done" || state === "missed" ? "done" : "awaiting_approval", assigned: { kind: "agent", id: "agt_labdesk" }, blocked: false },
    { taskId: "tsk_skool", key: "VY-312", title: "Post Lab 8 in the MLA AI Labs community", state: "done", assigned: { kind: "agent", id: "agt_content" }, blocked: false },
    { taskId: "tsk_reels", key: "VY-313", title: "Two short reels from the Lab 7 recording", state: "done", assigned: { kind: "person", id: "usr_aliza" }, blocked: false },
    { taskId: "tsk_news", key: "VY-314", title: "Lab 8 in Thursday's newsletter", state: "done", assigned: { kind: "agent", id: "agt_content" }, blocked: false },
    { taskId: "tsk_ads", key: "VY-315", title: "Retarget the Lab 8 lead form", state: state === "done" ? "done" : "doing", assigned: { kind: "agent", id: "agt_labdesk" }, blocked: false },
  ];
  const waiting: WaitLine[] = state === "active" || state === "budget" || state === "stuck"
    ? [{ taskId: "tsk_hold", kind: "approve", title: "Approve: email to 1,240 Lab 7 attendees", assigned: { kind: "person", id: "usr_irfad" }, since: now - 26 * HOUR },
      { taskId: "tsk_ask", kind: "answer", title: "Email the Lab 7 no-shows too?", assigned: { kind: "person", id: "usr_irfad" }, since: now - 3 * HOUR }]
    : [];
  const readings: Reading[] = [96, 118, 140, 171, 194, 212, ...(state === "missed" ? [240, 268] : state === "done" ? [253, 301] : [])].map((v, i) => ({ at: created + i * 0.75 * DAY, value: v, ok: true }));
  const activity: ActivityLine[] = [
    { at: now - 4 * 60_000, kind: "reading", text: "Luma, Lab 8 event: 212 (+18 since the last check-in)" },
    { at: now - 4 * HOUR, kind: "checkin", text: "Check-in 4: 212 of 300 registrations." },
    { at: now - 4 * HOUR + 60_000, kind: "report", text: "212, behind pace by 30. The Lab 7 reminder is the biggest lever; it waits on your approval.", by: "agt_labdesk>usr_irfad" },
    { at: now - 26 * HOUR, kind: "waiting", text: "Waiting: Approve: email to 1,240 Lab 7 attendees", ref: "tsk_hold" },
    { at: now - 2 * DAY, kind: "task", text: "Done: VY-312 Post Lab 8 in the MLA AI Labs community", ref: "tsk_skool" },
    { at: now - 4 * DAY, kind: "plan", text: "Planned VY-311 Remind Lab 7 attendees who have not registered. Why: past attendees registered at 31% after one reminder. Expected: +40 to +60", ref: "tsk_rem" },
    { at: now - 5 * DAY, kind: "started", text: "Started. Finish line: Luma registrations for Lab 8 reach 300." },
  ];
  const page: GoalPageData = { goal: state === "draft" ? { ...goal, status: "draft", permissions: goal.permissions.map((p) => ({ ...p, granted: false })) } : goal, tasks: state === "draft" ? [] : tasks, waiting, activity, readings };
  const line = (g: Goal): GoalLine => ({ id: g.id, title: g.title, status: g.status, ...(g.statusReason ? { statusReason: g.statusReason } : {}), owner: g.owner, leadAgentId: g.leadAgentId, deadline: g.deadline, ...(g.nextCheckinAt ? { nextCheckinAt: g.nextCheckinAt } : {}), progress: g.progress, updatedAt: g.updatedAt });
  const lines: GoalLine[] = [
    line(page.goal),
    { id: "gol_onboard", title: "Close every onboarding task for new clients", status: "active", owner: "usr_irfad", leadAgentId: "agt_content", deadline: now + 4 * DAY, nextCheckinAt: now + 6 * HOUR, progress: { items: 6, itemsDone: 4, percent: 66, tasksDone: 4, tasks: 6 }, updatedAt: now - HOUR },
    { id: "gol_reviews", title: "20 new Google reviews this month", status: "active", owner: "usr_irfad", leadAgentId: "agt_labdesk", deadline: now + 20 * DAY, nextCheckinAt: now + 2 * DAY, progress: { value: 7, target: 20, start: 0, percent: 35, tasksDone: 1, tasks: 3 }, updatedAt: now - 2 * HOUR },
  ];
  return { page, lines };
}

/** The goals capabilities of the sample Space, over `base` for everything else. */
export function goalsCall(base: (cap: string, input: unknown) => Promise<unknown>, now: number, state: SampleState): (cap: string, input: unknown) => Promise<unknown> {
  const { page, lines } = sampleGoals(now, state);
  return async (cap, input) => {
    const i = (input ?? {}) as Record<string, unknown>;
    if (cap === "goals.list") return { goals: i["scope"] === "helping" ? [] : lines };
    if (cap === "goals.get") return i["goalId"] === "gol_lab8" ? page : { ...page, goal: { ...page.goal, ...lines.find((l) => l.id === i["goalId"]) } };
    if (cap === "goals.activity") return { activity: page.activity };
    if (cap === "files.list" && i["folder"] === "fld_goal") return { files: [{ fileId: "fil_r1", name: "Reel 1, the three questions.mp4" }, { fileId: "fil_r2", name: "Reel 2, before and after.mp4" }, { fileId: "fil_csv", name: "Lab 7 not registered.csv" }], folders: [{ folderId: "fld_drafts", name: "Drafts" }, { folderId: "fld_research", name: "Research" }] };
    if (cap === "tasks.get" && i["taskId"] === "tsk_hold") return { task: { id: "tsk_hold", kind: "approve", state: "awaiting_approval", actions: [{ key: "approve", label: "Approve" }], blocks: [] } };
    if (cap === "tasks.get" && i["taskId"] === "tsk_ask") return { task: { id: "tsk_ask", kind: "answer", state: "todo", actions: [{ key: "answer", label: "Answer" }], blocks: [{ type: "question", data: { options: ["Yes, them too", "Only attendees"] } }] } };
    if (cap.startsWith("goals.")) return { goal: page.goal };
    return base(cap, input);
  };
}
