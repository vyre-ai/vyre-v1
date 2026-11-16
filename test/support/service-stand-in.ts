// The services a key is pasted for, and ONE stand-in network that answers by host the way each service's public documents say (r32-connect, 16 Nov 2026). It repeats every credential it was sent (the Authorization header, its Basic
// decoding and the body) in its error words, so a test can prove that nothing of an answer reaches a person, a log, an event or a stored row. A value with BADKEY in it is a wrong key, LIMITED a key without the permission,
// DOWN a service that answers 503, OFFLINE a service that cannot be reached; anything else is a good key.
export interface Seen {
  host: string;
  path: string;
  method: string;
  url: string;
  auth: string;
  body: string;
}
export interface Svc {
  title: string;
  /** the connector that is run once connected */
  key: string;
  fields: string[];
  host: string;
  /** an action to run once connected, and the host it goes to */
  run: { action: string; host: string; input?: Record<string, string> };
  wrong: number;
  limited?: number;
  choice?: string;
}
export const SVCS: Svc[] = [
  {
    title: "Stripe",
    key: "stripe",
    fields: ["Stripe_Key"],
    host: "api.stripe.com",
    run: { action: "list_customers", host: "api.stripe.com" },
    wrong: 401,
    limited: 403,
  },
  {
    title: "Resend",
    key: "resend",
    fields: ["Resend_Key"],
    host: "api.resend.com",
    run: { action: "list_domains", host: "api.resend.com" },
    wrong: 400,
    limited: 401,
  },
  {
    title: "HubSpot",
    key: "hubspot",
    fields: ["HubSpot_Token"],
    host: "api.hubapi.com",
    run: { action: "list_contacts", host: "api.hubapi.com" },
    wrong: 401,
    limited: 403,
  },
  {
    title: "Mailgun",
    key: "mailgun",
    fields: ["Mailgun_Key"],
    host: "api.mailgun.net",
    run: { action: "list_domains", host: "api.mailgun.net" },
    wrong: 401,
    limited: 403,
    choice: "us",
  },
  {
    title: "Mailgun",
    key: "mailgun-eu",
    fields: ["Mailgun_Key"],
    host: "api.eu.mailgun.net",
    run: { action: "list_domains", host: "api.eu.mailgun.net" },
    wrong: 401,
    limited: 403,
    choice: "eu",
  },
  {
    title: "Dropbox Sign",
    key: "dropbox-sign",
    fields: ["DropboxSign_Key"],
    host: "api.hellosign.com",
    run: { action: "check_account", host: "api.hellosign.com" },
    wrong: 401,
    limited: 403,
  },
  {
    title: "Zoom",
    key: "zoom",
    fields: ["Zoom_Account_Id", "Zoom_Client_Id", "Zoom_Client_Secret"],
    host: "zoom.us",
    run: { action: "list_meetings", host: "api.zoom.us" },
    wrong: 400,
  },
  {
    title: "Twilio",
    key: "twilio",
    fields: ["Twilio_Account", "Twilio_Auth"],
    host: "api.twilio.com",
    run: { action: "check_account", host: "api.twilio.com" },
    wrong: 401,
    limited: 403,
  },
];

/** every Basic credential the stand-in was sent (the encoded pair): it is searched for in the data folder too */

export const decode = (auth: string): string =>
  auth.startsWith("Basic ") ? Buffer.from(auth.slice(6), "base64").toString() : auth;
/** The stand-in network: answers by host, and repeats what it was sent in its error words. */
export const serviceNetwork = (seen: Seen[], basics: Set<string>) => ({
  resolve: async () => ["93.184.216.34"],
  request: async (url: URL, o: { method?: string; headers: Record<string, string>; body?: string }) => {
    const auth = Object.entries(o.headers).find(([k]) => k.toLowerCase() === "authorization")?.[1] ?? "";
    const rec: Seen = {
      host: url.hostname,
      path: url.pathname,
      method: o.method ?? "GET",
      url: url.toString(),
      auth,
      body: o.body ?? "",
    };
    seen.push(rec);
    const material = `${auth} ${decode(auth)} ${rec.body}`;
    const echo = JSON.stringify({ message: "rejected", auth, plain: decode(auth), body: rec.body });
    const svc = SVCS.find((s) => s.host === url.hostname || s.run.host === url.hostname);
    if (/OFFLINE/.test(material)) throw new Error(`ECONNREFUSED ${material}`);
    if (auth.startsWith("Basic ")) basics.add(auth.slice(6));
    if (/BADKEY/.test(material))
      return {
        status: svc?.wrong ?? 401,
        text:
          svc?.key === "resend"
            ? JSON.stringify({ name: "validation_error", message: "API key is invalid", echo })
            : echo,
      };
    if (/LIMITED/.test(material))
      return {
        status: svc?.limited ?? 403,
        text: svc?.key === "resend" ? JSON.stringify({ name: "restricted_api_key", echo }) : echo,
      };
    if (/DOWN/.test(material)) return { status: 503, text: echo };
    if (url.hostname === "zoom.us")
      return { status: 200, text: JSON.stringify({ access_token: "ZTOK_standin_value_01", token_type: "bearer" }) };
    if (url.hostname === "api.zoom.us" && auth !== "Bearer ZTOK_standin_value_01") return { status: 401, text: echo };
    return {
      status: 200,
      text: JSON.stringify({ data: [], items: [], meetings: [], accounts: [], results: [], account: {}, object: "ok" }),
    };
  },
});
