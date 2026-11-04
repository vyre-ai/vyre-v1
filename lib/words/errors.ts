// What a person reads when something goes wrong. One catalog keyed by error code: what happened, and the next step. A raised message that is already plain wins; one that carries an id, a code or a
// tool name falls back to this. The code and trace id never go in the text: they go in a "Copy details" line (`details`).
export interface Described { /** what happened, in plain words */ text: string; /** the next step, one short sentence */ next: string; /** for a Details or "Copy details" affordance only */ details: string }

interface Words { what: string; next: string }

export const ERROR_WORDS: Readonly<Record<string, Words>> = {
  "auth.unauthenticated": { what: "You are signed out.", next: "Sign in again to go on." },
  "auth.expired": { what: "Your sign-in ran out.", next: "Sign in again to go on." },
  "auth.device_revoked": { what: "This device was signed out by an admin.", next: "Sign in again, or ask an admin." },
  "auth.second_factor_required": { what: "A second step is needed to sign in.", next: "Enter the code from your authenticator." },
  "auth.invalid_code": { what: "That code did not work. It may be wrong, used already or expired.", next: "Ask for a new one." },
  "auth.bad_credentials": { what: "The Space, username or password is wrong.", next: "Check them and try again." },
  "rate_limit.exceeded": { what: "That is too many requests in a short time.", next: "Wait a moment and try again." },
  "validation.bad_input": { what: "Something in what you entered is not right.", next: "Check the highlighted fields and try again." },
  "validation.unknown_capability": { what: "This server does not know how to do that.", next: "Update the app, or ask an admin." },
  "validation.not_found": { what: "We could not find that. It may have been removed.", next: "Go back and pick it again." },
  "validation.duplicate": { what: "That already exists.", next: "Use a different name." },
  "validation.field_locked": { what: "That cannot be changed right now.", next: "Ask whoever approved it to unlock it." },
  "validation.version_conflict": { what: "Someone else changed this while you were editing.", next: "Reload to see their change, then redo yours." },
  "validation.precondition_failed": { what: "That cannot be done in the current state.", next: "Check where it stands and try again." },
  "validation.too_large": { what: "That is too big.", next: "Use a smaller file or less text." },
  "validation.unsupported": { what: "This is not supported here.", next: "Try another way, or ask an admin." },
  "provider.rate_limited": { what: "The AI service is busy and asked us to slow down.", next: "Wait a minute and try again." },
  "provider.auth_failed": { what: "The AI service did not accept the saved key.", next: "Update the key in Settings." },
  "provider.overloaded": { what: "The AI service is overloaded right now.", next: "Try again in a few minutes." },
  "provider.context_too_long": { what: "That is more than the model can read at once.", next: "Use a shorter chat or fewer files." },
  "provider.content_filtered": { what: "The AI service would not answer that.", next: "Reword the request and try again." },
  "provider.network": { what: "We could not reach the service.", next: "Check your connection and try again." },
  "provider.unavailable": { what: "The service is down right now.", next: "Try again later." },
  "provider.bad_response": { what: "The service answered in a way we could not read.", next: "Try again. If it keeps happening, report it." },
  "timeout.deadline": { what: "That took too long and stopped.", next: "Try again." },
  "timeout.provider": { what: "The service did not answer in time.", next: "Try again." },
  "permission.no_grant": { what: "You do not have access to that.", next: "Ask the owner to share it with you." },
  "permission.role_lacks_permission": { what: "Your role does not allow that.", next: "Ask an admin." },
  "permission.above_clearance": { what: "That is restricted beyond what you can open.", next: "Ask an admin for access." },
  "permission.on_hold": { what: "A hold stops this change.", next: "Ask an admin to lift the hold." },
  "permission.suspended": { what: "This account is suspended.", next: "Ask an admin." },
  "permission.provider_label": { what: "That is restricted and cannot be sent to this AI service.", next: "Pick another model, or remove the restricted part." },
  "permission.limit": { what: "A spending or usage limit stopped this.", next: "Ask an admin to raise the limit." },
  "permission.plan_mode": { what: "You are in plan mode, so nothing changes yet.", next: "Approve the plan to make the change." },
  "permission.not_found": { what: "We could not find that, or you cannot see it.", next: "Ask the owner to share it with you." },
  "permission.not_contained": { what: "You can only share what you have yourself.", next: "Give less than you hold." },
  "permission.expired": { what: "That access has run out.", next: "Ask for it again." },
  "permission.revoked": { what: "That access was taken away.", next: "Ask for it again." },
  "permission.guest_cannot_request": { what: "Guests cannot ask for more access.", next: "Ask the person who invited you." },
  "permission.needs_team": { what: "This needs a team Space.", next: "Make a team Space to use it." },
  "permission.needs_approval": { what: "This needs approval first, so it is waiting.", next: "It goes ahead once someone approves it." },
  "internal.unexpected": { what: "Something went wrong on our side.", next: "Try again. If it keeps happening, report a problem." },
  "internal.not_implemented": { what: "This is not ready yet.", next: "Check back after the next update." },
  "internal.unavailable": { what: "The server is starting or paused for a moment.", next: "Try again in a minute." },
};

const GROUP: Readonly<Record<string, Words>> = {
  auth: ERROR_WORDS["auth.unauthenticated"]!, rate_limit: ERROR_WORDS["rate_limit.exceeded"]!, validation: ERROR_WORDS["validation.bad_input"]!, provider: ERROR_WORDS["provider.unavailable"]!,
  timeout: ERROR_WORDS["timeout.deadline"]!, permission: ERROR_WORDS["permission.no_grant"]!, internal: ERROR_WORDS["internal.unexpected"]!,
};

const GROUPS = "auth|rate_limit|validation|provider|timeout|permission|internal|policy|conflict|limit|sync|gate|network";
const FILE_ENDINGS = "toml|json|md|txt|pdf|csv|com|org|net|io|app|me|ai|html|js|ts|tsx|png|jpg|jpeg|gif|svg|xml|yaml|yml|docx|xlsx|pptx|zip|env|log|sql|py|sh|mp3|mp4|wav|vcf|ics|eml";
const CODE_LIKE = new RegExp([
  `\\b(?:agt|usr|svc|tsk|grt|rec|fld|rol|grp|thr|msg|trc|tr|goal|ses|dev|spc)_[A-Za-z0-9]{3,}`,   // ids
  `\\b(?:${GROUPS})\\.[a-z_]+\\b`,                                                                 // error codes
  `\\b[a-z]{3,}\\.(?!(?:${FILE_ENDINGS})\\b)[a-z]{3,}(?:_[a-z]+)*\\b`,                             // capability or tool names (tasks.assign)
  `\\b[a-z]+(?:_[a-z]+){1,}\\b`,                                                                   // snake_case codes (keep_a, own_capability)
  `\\b[0-9a-f]{12,}\\b`,                                                                           // hex traces
].join("|"));

/** Does this text carry an id, an error code, a tool name or a trace? A person should never read one. */
export const looksLikeCode = (s: string): boolean => CODE_LIKE.test(s);

/** A sentence a person reads: a capital to start, a full stop to end. */
export function plainSentence(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t === "") return t;
  const c = t[0]!.toUpperCase() + t.slice(1);
  return /[.!?:)"”]$/.test(c) ? c : `${c}.`;
}

/**
 * The words for an error. `message` is what the server raised; it is used when it is plain, and the catalog's words stand in when it is empty or carries a code or id.
 * `details` holds the code and trace for a "Copy details" button. It is never part of `text`.
 */
export function describeError(code: string | undefined, ctx: { message?: string | undefined; traceId?: string | undefined } = {}): Described {
  const c = code ?? "internal.unexpected";
  const w = ERROR_WORDS[c] ?? GROUP[c.split(".")[0] ?? ""] ?? ERROR_WORDS["internal.unexpected"]!;
  const own = ctx.message !== undefined && ctx.message.trim() !== "" && !looksLikeCode(ctx.message) ? plainSentence(ctx.message) : undefined;
  return { text: own ?? w.what, next: w.next, details: [c, ctx.traceId].filter((x): x is string => !!x).join(" · ") };
}

const MACHINE_TALK = /\b(?:undefined|null|NaN|TypeError|RangeError|SyntaxError|ReferenceError|ECONN\w*|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|fetch failed|Failed to fetch|NetworkError|Unexpected token|JSON|stack|at \S+:\d+)\b/;

/**
 * The words for anything a screen caught. A VyreError (code, message, traceId) goes through `describeError`. A plain JavaScript error keeps its message only when it reads like a sentence for a person;
 * machine talk ("TypeError", "fetch failed", "undefined") is replaced by the connection words or by `fallback`.
 */
export function problemWords(e: unknown, fallback?: string): Described {
  const x = (e ?? {}) as { code?: unknown; message?: unknown; traceId?: unknown };
  const code = typeof x.code === "string" ? x.code : undefined;
  const message = typeof x.message === "string" ? x.message : undefined;
  const traceId = typeof x.traceId === "string" ? x.traceId : undefined;
  if (code !== undefined && /^[a-z_]+\.[a-z_]+$/.test(code)) return describeError(code, { message, traceId });
  if (message !== undefined && /fetch failed|Failed to fetch|NetworkError|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|Network request failed/i.test(message)) {
    return { text: "We could not reach the server.", next: "Check your connection and try again.", details: message.slice(0, 200) };
  }
  const plain = message !== undefined && message.trim() !== "" && !looksLikeCode(message) && !MACHINE_TALK.test(message);
  const w = ERROR_WORDS["internal.unexpected"]!;
  return { text: plain ? plainSentence(message!) : fallback ?? w.what, next: w.next, details: [code, traceId, plain || message === undefined ? "" : message.slice(0, 200)].filter(Boolean).join(" · ") };
}
