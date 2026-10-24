// Fake Zoom behind api.zoom.us (ARCH 8.3, 10.1). Health is GET /users/me.
import { handledFetch, hostIs, recordingFetch, type FetchLike, type Handler, type ReplayTape, type SeenCall } from "./replay.ts";

export interface ZoomMeetingInput {
  topic: string;
  startTime?: string;
  durationMinutes?: number;
}

export interface ZoomMeeting {
  id: string;
  topic: string;
  joinUrl: string;
}

export interface ZoomProvider {
  readonly name: "zoom";
  readonly calls: SeenCall[];
  readonly fetch: FetchLike;
  me(): Promise<{ id: string; email: string }>;
  createMeeting(input: ZoomMeetingInput): Promise<ZoomMeeting>;
}

export function fakeZoom(opts: { tape?: ReplayTape; fetch?: FetchLike } = {}): ZoomProvider {
  const calls: SeenCall[] = [];
  let n = 0;
  const handlers: Handler[] = [
    {
      method: "GET",
      match: (u) => hostIs(u, "zoom.us") && u.pathname === "/v2/users/me",
      run: () => ({ body: { id: "user-fake", email: "ada@example.com", account_id: "acct-fake" } }),
    },
    {
      method: "POST",
      match: (u) => hostIs(u, "zoom.us") && u.pathname === "/v2/users/me/meetings",
      run: (_u, init) => {
        n += 1;
        const parsed = init.body ? JSON.parse(init.body) as Record<string, unknown> : {};
        const id = String(80000000000 + n);
        const topic = typeof parsed.topic === "string" ? parsed.topic : "Meeting";
        return { body: { id, topic, join_url: `https://zoom.us/j/${id}`, start_time: parsed.start_time ?? null } };
      },
    },
  ];
  const fetch = recordingFetch(opts.fetch ?? handledFetch(handlers, opts.tape), calls);
  return {
    name: "zoom",
    calls,
    fetch,
    async me() {
      const res = await fetch("https://api.zoom.us/v2/users/me");
      if (res.status !== 200) throw new Error(`zoom me returned ${res.status}`);
      const body = JSON.parse(await res.text()) as { id: string; email: string };
      return { id: body.id, email: body.email };
    },
    async createMeeting(input) {
      const payload: Record<string, unknown> = { topic: input.topic };
      if (input.startTime !== undefined) payload.start_time = input.startTime;
      if (input.durationMinutes !== undefined) payload.duration = input.durationMinutes;
      const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status !== 200) throw new Error(`zoom create returned ${res.status}`);
      const body = JSON.parse(await res.text()) as { id: string; topic: string; join_url: string };
      return { id: body.id, topic: body.topic, joinUrl: body.join_url };
    },
  };
}
