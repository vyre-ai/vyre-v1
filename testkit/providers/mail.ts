// Fake mail transport behind the Resend and Mailgun hosts mail.send uses (ARCH 8.2, 10.1).
import { handledFetch, hostIs, recordingFetch, type FetchLike, type Handler, type ReplayTape, type SeenCall } from "./replay.ts";

export interface MailMessage {
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
}

export interface MailProvider {
  readonly name: "mail";
  readonly calls: SeenCall[];
  readonly fetch: FetchLike;
  send(message: MailMessage): Promise<{ id: string }>;
  sent(): MailMessage[];
}

export function fakeMail(opts: { tape?: ReplayTape; fetch?: FetchLike } = {}): MailProvider {
  const sentBox: MailMessage[] = [];
  let n = 0;
  const calls: SeenCall[] = [];
  const handlers: Handler[] = [
    {
      method: "POST",
      match: (u) => (hostIs(u, "resend.com") && u.pathname === "/emails") || (hostIs(u, "mailgun.net") && u.pathname.endsWith("/messages")),
      run: (_u, init) => {
        const msg = asMessage(init.body);
        n += 1;
        sentBox.push(msg);
        return { body: { id: `email_${n}` } };
      },
    },
    {
      method: "GET",
      match: (u) => hostIs(u, "resend.com") && u.pathname === "/emails",
      run: () => ({ body: { data: sentBox.map((m, i) => ({ id: `email_${i + 1}`, ...m })) } }),
    },
  ];
  const fetch = recordingFetch(opts.fetch ?? handledFetch(handlers, opts.tape), calls);
  return {
    name: "mail",
    calls,
    fetch,
    async send(message) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
      });
      if (res.status !== 200) throw new Error(`mail send returned ${res.status}`);
      return JSON.parse(await res.text()) as { id: string };
    },
    sent: () => sentBox.slice(),
  };
}

function asMessage(body: string | undefined): MailMessage {
  const parsed = body ? JSON.parse(body) as Record<string, unknown> : {};
  const to = Array.isArray(parsed.to) ? parsed.to.filter((x): x is string => typeof x === "string") : [];
  const msg: MailMessage = {
    from: typeof parsed.from === "string" ? parsed.from : "",
    to,
    subject: typeof parsed.subject === "string" ? parsed.subject : "",
  };
  if (typeof parsed.text === "string") msg.text = parsed.text;
  if (typeof parsed.html === "string") msg.html = parsed.html;
  return msg;
}
