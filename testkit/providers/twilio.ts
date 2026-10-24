// Fake Twilio account behind api.twilio.com (ARCH 8 table, 10.1). Health is GET /Accounts/{sid}.
import { handledFetch, hostIs, recordingFetch, type FetchLike, type Handler, type ReplayTape, type SeenCall } from "./replay.ts";

export const TWILIO_ACCOUNT_SID = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export interface TwilioSms {
  from: string;
  to: string;
  body: string;
}

export interface TwilioProvider {
  readonly name: "twilio";
  readonly calls: SeenCall[];
  readonly fetch: FetchLike;
  health(): Promise<{ sid: string; status: string }>;
  smsSend(message: TwilioSms): Promise<{ sid: string; status: string }>;
}

export function fakeTwilio(opts: { tape?: ReplayTape; fetch?: FetchLike } = {}): TwilioProvider {
  const calls: SeenCall[] = [];
  let n = 0;
  const account = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}`;
  const handlers: Handler[] = [
    {
      method: "GET",
      match: (u) => hostIs(u, "twilio.com") && u.pathname === `/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}.json`,
      run: () => ({ body: { sid: TWILIO_ACCOUNT_SID, status: "active", friendly_name: "Fake" } }),
    },
    {
      method: "POST",
      match: (u) => hostIs(u, "twilio.com") && u.pathname === `/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      run: (_u, init) => {
        n += 1;
        const fields = fieldsOf(init.body);
        return {
          body: {
            sid: `SM${String(n).padStart(32, "0")}`,
            status: "queued",
            from: fields.From ?? fields.from ?? "",
            to: fields.To ?? fields.to ?? "",
            body: fields.Body ?? fields.body ?? "",
          },
        };
      },
    },
  ];
  const fetch = recordingFetch(opts.fetch ?? handledFetch(handlers, opts.tape), calls);
  return {
    name: "twilio",
    calls,
    fetch,
    async health() {
      const res = await fetch(`${account}.json`);
      if (res.status !== 200) throw new Error(`twilio health returned ${res.status}`);
      return JSON.parse(await res.text()) as { sid: string; status: string };
    },
    async smsSend(message) {
      const res = await fetch(`${account}/Messages.json`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ From: message.from, To: message.to, Body: message.body }),
      });
      if (res.status !== 200) throw new Error(`twilio sms returned ${res.status}`);
      return JSON.parse(await res.text()) as { sid: string; status: string };
    },
  };
}

function fieldsOf(body: string | undefined): Record<string, string> {
  if (!body) return {};
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return Object.fromEntries(new URLSearchParams(body).entries());
  }
}
