// Google Workspace and Microsoft 365 setup (Console > Integrations): the words, links, scopes and rules the two guided pages share. Pure functions, no I/O, so the rules are tested
// without drawing anything. The pages that draw them are GoogleWorkspace.tsx and Microsoft365.tsx.

export type ServiceState = "healthy" | "degraded";
export interface ServiceRow { key: string; title: string; state: ServiceState; hint: string }

export const GOOGLE_HANDLE = "#Google_DWD";
export const MICROSOFT_HANDLE = "#Microsoft_App";
/** The shared Vault folder the connection keys go in when the person has none to choose from. */
export const CONNECTIONS_FOLDER = "Company connections";

export const GOOGLE_LINKS = {
  serviceAccounts: "https://console.cloud.google.com/iam-admin/serviceaccounts",
  apiLibrary: "https://console.cloud.google.com/apis/library",
  adminDelegation: "https://admin.google.com/ac/owl/domainwidedelegation",
} as const;
export const MICROSOFT_LINKS = {
  appRegistrations: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
  exchangePowerShell: "https://learn.microsoft.com/powershell/exchange/connect-to-exchange-online-powershell",
} as const;

/** The Google APIs to switch on in the project the service account lives in. */
export const GOOGLE_APIS = ["Gmail API", "Google Calendar API", "Google Drive API", "Google Docs API", "Google Sheets API", "Google Meet REST API"] as const;

/** What each Google scope lets Vyre do, by the short name Google Admin shows after the last slash. */
export const GOOGLE_SCOPE_USE: Readonly<Record<string, string>> = {
  "gmail.modify": "Read, label, draft and send mail for included members",
  calendar: "Read and write calendars",
  drive: "Read and write Drive files",
  spreadsheets: "Read and write Sheets",
  documents: "Read and write Docs",
  "meetings.space.readonly": "Read Meet recordings and transcripts",
};

export const MICROSOFT_PERMISSION_USE: Readonly<Record<string, string>> = {
  "Mail.ReadWrite": "Read, move and draft mail for included members",
  "Mail.Send": "Send mail as an included member",
  "Calendars.ReadWrite": "Read and write calendars",
  "Files.ReadWrite.All": "Read and write OneDrive and SharePoint files",
  "User.Read.All": "Match people in your tenant to members by email",
  "OnlineMeetingRecording.Read.All": "Read Teams meeting recordings",
  "OnlineMeetingTranscript.Read.All": "Read Teams meeting transcripts",
};

interface ServiceDef { key: string; title: string; needs: readonly string[]; what: string }

const GOOGLE_SERVICES: readonly ServiceDef[] = [
  { key: "mail", title: "Mail", needs: ["gmail.modify"], what: "Gmail" },
  { key: "calendar", title: "Calendar", needs: ["calendar"], what: "Google Calendar" },
  { key: "drive", title: "Drive", needs: ["drive"], what: "Google Drive" },
  { key: "meet", title: "Meet", needs: ["meetings.space.readonly"], what: "Meet transcripts" },
  { key: "docs", title: "Docs and Sheets", needs: ["documents", "spreadsheets"], what: "Docs and Sheets" },
];
const MICROSOFT_SERVICES: readonly ServiceDef[] = [
  { key: "mail", title: "Mail", needs: ["Mail.ReadWrite", "Mail.Send"], what: "Outlook mail" },
  { key: "calendar", title: "Calendar", needs: ["Calendars.ReadWrite"], what: "Outlook calendar" },
  { key: "drive", title: "OneDrive and SharePoint", needs: ["Files.ReadWrite.All"], what: "OneDrive and SharePoint" },
  { key: "teams", title: "Teams", needs: ["OnlineMeetingRecording.Read.All", "OnlineMeetingTranscript.Read.All"], what: "Teams recordings and transcripts" },
  { key: "people", title: "People", needs: ["User.Read.All"], what: "Your tenant's people" },
];

export interface ServiceInput {
  configured: boolean;
  /** The result of the last check made on this page; null when none was made yet. */
  checked: { ok: boolean; missing: readonly string[]; detail?: string | undefined } | null;
  /** What the server remembers of the last probe, for a page opened fresh. */
  lastOk: boolean | null | undefined;
}

export const shortScope = (scope: string): string => scope.slice(scope.lastIndexOf("/") + 1);

/**
 * One row per service. The Vyre health rule: a connection that was never set up reads healthy with a hint, never as a failure, because nothing is broken. A service is degraded
 * when a check named a permission it needs as missing, and the hint names exactly that permission and where to add it.
 */
export function serviceRows(provider: "google" | "microsoft", i: ServiceInput): ServiceRow[] {
  const defs = provider === "google" ? GOOGLE_SERVICES : MICROSOFT_SERVICES;
  const where = provider === "google" ? "Google Admin console" : "Azure app registration";
  return defs.map((d): ServiceRow => {
    if (!i.configured) return { key: d.key, title: d.title, state: "healthy", hint: "Not set up yet. Follow the setup steps." };
    if (i.checked) {
      const missing = d.needs.filter((n) => i.checked!.missing.map(shortScope).includes(n));
      if (missing.length > 0) return { key: d.key, title: d.title, state: "degraded", hint: `Add ${missing.join(" and ")} in the ${where}, then check again.` };
      if (!i.checked.ok && i.checked.missing.length === 0) return { key: d.key, title: d.title, state: "degraded", hint: i.checked.detail ?? `${d.what} did not answer the check. Check again in a minute.` };
      return { key: d.key, title: d.title, state: "healthy", hint: `${d.what} is working.` };
    }
    if (i.lastOk === false) return { key: d.key, title: d.title, state: "degraded", hint: "The last check failed. Press Check connection to see what is missing." };
    if (i.lastOk === true) return { key: d.key, title: d.title, state: "healthy", hint: `${d.what} was working at the last check.` };
    return { key: d.key, title: d.title, state: "healthy", hint: "Not checked yet. Press Check connection." };
  });
}

export interface Summary { tone: "ok" | "warn"; title: string; line: string }

/** The line at the top of a page. Not set up reads healthy with a hint. */
export function summaryOf(provider: "google" | "microsoft", rows: readonly ServiceRow[], configured: boolean, members: number): Summary {
  const name = provider === "google" ? "Google Workspace" : "Microsoft 365";
  if (!configured) return { tone: "ok", title: `${name} is not connected`, line: "Nothing is wrong. Follow the steps below when you are ready to connect your firm's suite." };
  const bad = rows.filter((r) => r.state === "degraded");
  if (bad.length > 0) return { tone: "warn", title: `${name} needs attention`, line: `${bad.map((r) => r.title).join(", ")} ${bad.length === 1 ? "needs" : "need"} a change. ${bad[0]!.hint}` };
  return { tone: "ok", title: `${name} is connected`, line: `${members} ${members === 1 ? "member is" : "members are"} included.` };
}

// ---- what a person pastes

export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

export interface GoogleKey { clientId: string; clientEmail: string; projectId: string }

/** Reads a service-account key as Google downloads it. Only the non-secret identity comes out; the private key stays in the text and goes to the Vault as it is. */
export function parseGoogleKey(text: string): Parsed<GoogleKey> {
  const wrong = "That is not a Google service-account key. In Google Cloud open the service account, choose Keys, Add key, Create new key, JSON, and paste the whole file.";
  let o: Record<string, unknown>;
  try { o = JSON.parse(text.trim()) as Record<string, unknown>; } catch { return { ok: false, problem: "The key is not valid JSON. Paste the whole file, from the first { to the last }." }; }
  if (o === null || typeof o !== "object" || o["type"] !== "service_account") return { ok: false, problem: wrong };
  const clientId = o["client_id"], clientEmail = o["client_email"], privateKey = o["private_key"], projectId = o["project_id"];
  if (typeof clientId !== "string" || !/^\d{10,30}$/.test(clientId)) return { ok: false, problem: wrong };
  if (typeof clientEmail !== "string" || !clientEmail.includes("@")) return { ok: false, problem: wrong };
  if (typeof privateKey !== "string" || !privateKey.includes("BEGIN PRIVATE KEY")) return { ok: false, problem: wrong };
  return { ok: true, value: { clientId, clientEmail, projectId: typeof projectId === "string" ? projectId : "" } };
}

export interface MicrosoftApp { tenantId: string; clientId: string; clientSecret: string }
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

/** Checks the three values from the app registration and returns the text the Vault item holds. */
export function microsoftSecret(app: MicrosoftApp): Parsed<string> {
  const tenantId = app.tenantId.trim(), clientId = app.clientId.trim(), clientSecret = app.clientSecret.trim();
  if (!TENANT.test(tenantId)) return { ok: false, problem: "The tenant ID is a code like 11111111-2222-3333-4444-555555555555, or your domain such as yourfirm.com." };
  if (!GUID.test(clientId)) return { ok: false, problem: "The application (client) ID is a code like 11111111-2222-3333-4444-555555555555. Copy it from the app's Overview page." };
  if (clientSecret.length < 8 || /\s/.test(clientSecret)) return { ok: false, problem: "Paste the client secret's Value, not its ID. It has no spaces and is at least 8 characters." };
  return { ok: true, value: JSON.stringify({ tenantId, clientId, clientSecret }) };
}

export const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
export const domainOf = (email: string): string => email.slice(email.indexOf("@") + 1).trim().toLowerCase();

// ---- members

export interface MemberRow { email: string; userId?: string | undefined; mapped: boolean; excluded: boolean; mailboxState?: string | undefined }

export function memberNote(m: MemberRow): string {
  if (m.excluded) return "Excluded. Vyre never reads this person's mail or calendar.";
  if (!m.mapped) return "Not matched to a Vyre member.";
  const state = m.mailboxState;
  if (state === "pending") return "Included. Waiting for them to accept the connection.";
  if (state === "connected" || state === "syncing") return "Included. Mail and calendar are syncing.";
  return "Included.";
}

/** The sentence that tells a person what is theirs to do when the firm has not connected a service. */
export function personLine(configured: boolean, excluded: boolean, name: string): string {
  if (!configured) return `${name} is not connected for your firm yet. Ask your admin to open Console, Integrations, ${name}.`;
  if (excluded) return `Connected through your firm, but your account is excluded, so ${name} never reads your mail or calendar.`;
  return "Connected through your firm";
}
