// Connect your company, the one description of it: the steps, what each is called, and where in the docs each is explained. The server reports against these, the screen draws them, the skill follows them, and a test
// holds the two doc pages to them, so the flow and the docs cannot say different things.
export type CompanyProvider = "google" | "microsoft";
export type StepId = "choose" | "signin_app" | "signin_try" | "signin_require" | "access_key" | "access_allow" | "access_limit" | "access_probe" | "people" | "confirm";
export interface FlowStep { id: StepId; title: string; doc: string; optional?: boolean }

const shared = {
  choose: { id: "choose", title: "Choose what to connect", doc: "choose-what-to-connect" },
  try: { id: "signin_try", title: "Try the sign-in", doc: "try-the-sign-in" },
  require: { id: "signin_require", title: "Decide if everyone must use it", doc: "decide-if-everyone-must-use-it", optional: true },
  probe: { id: "access_probe", title: "Run the read-only check", doc: "run-the-read-only-check" },
  people: { id: "people", title: "Choose who is in", doc: "choose-who-is-in" },
  confirm: { id: "confirm", title: "Connect", doc: "connect" },
} as const satisfies Record<string, FlowStep>;

export const FLOW_STEPS: Readonly<Record<CompanyProvider, readonly FlowStep[]>> = {
  google: [
    shared.choose,
    { id: "access_key", title: "Make the service account and add its key", doc: "make-the-service-account-and-add-its-key" },
    { id: "access_allow", title: "Allow the scopes in Google Admin", doc: "allow-the-scopes-in-google-admin" },
    { id: "signin_app", title: "Make the sign-in app", doc: "make-the-sign-in-app" },
    shared.try, shared.require, shared.probe, shared.people, shared.confirm,
  ],
  microsoft: [
    shared.choose,
    { id: "access_key", title: "Register the app and add it", doc: "register-the-app-and-add-it" },
    { id: "access_allow", title: "Grant admin consent", doc: "grant-admin-consent" },
    { id: "access_limit", title: "Limit the app to your members' mailboxes", doc: "limit-the-app-to-your-members-mailboxes" },
    { id: "signin_app", title: "Turn on sign-in", doc: "turn-on-sign-in" },
    shared.try, shared.require, shared.probe, shared.people, shared.confirm,
  ],
};

export const DOC_PAGE: Readonly<Record<CompanyProvider, string>> = { google: "connect-google-workspace", microsoft: "connect-microsoft-365" };
export const PROVIDER_TITLE: Readonly<Record<CompanyProvider, string>> = { google: "Google Workspace", microsoft: "Microsoft 365" };

/** Words that start this flow in chat. Tested against what people type; a miss only means Assistant reads the skill a turn later. */
export const COMPANY_INTENT = /\b(connect|set ?up|hook ?up|link|add|turn on)\b.{0,40}\b(google workspace|workspace|microsoft 365|office 365|m365|o365|entra|azure ad|company|our (mail|email|calendar|drive|onedrive|sharepoint)|sso|single sign[- ]on|company login|space[- ]wide login)\b|\bsign in with (google|microsoft)\b/i;

const slug = (heading: string): string => heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/\s+/g, "-");

/** One section of a guide, ready for the chat's markdown: a table reads as lines, because that renderer has no tables. Null when the section is not there. */
export function docSection(page: string, section: string): string | null {
  const parts = page.split(/^(?=## )/m);
  const hit = parts.find((p) => p.startsWith("## ") && slug(p.split("\n", 1)[0]!.slice(3)) === section);
  if (!hit) return null;
  return hit.split("\n").slice(1).flatMap((line) => {
    if (/^\|[\s:|-]+\|$/.test(line)) return [];
    if (!line.startsWith("|")) return [line];
    return [`- ${line.split("|").slice(1, -1).map((c) => c.trim()).filter(Boolean).join(": ")}`];
  }).join("\n").trim();
}

/** The one next thing, as the server reports it: the first step not done. */
export function nextStep(provider: CompanyProvider, done: ReadonlySet<StepId>): FlowStep | null {
  return FLOW_STEPS[provider].find((s) => !done.has(s.id) && s.optional !== true) ?? null;
}
