// Fake provider kit (ARCH 10.1): one fake per provider behind the HTTP interface connectors use,
// plus scripted LLM streams. createTestSpace returns this bag as fakeProviders.
import { fakeDocumenso, type DocumensoProvider } from "./documenso.ts";
import { fakeGithub, type GithubProvider } from "./github.ts";
import { fakeGoogle, type GoogleProvider } from "./google.ts";
import { fakeLlm, type LlmOptions, type LlmProvider } from "./llm.ts";
import { fakeMail, type MailProvider } from "./mail.ts";
import { fakeMicrosoft, type MicrosoftProvider } from "./microsoft.ts";
import { ReplayMiss, type FetchLike, type ReplayTape } from "./replay.ts";
import { fakeStripe, type StripeProvider } from "./stripe.ts";
import { fakeTwilio, type TwilioProvider } from "./twilio.ts";
import { fakeZoom, type ZoomProvider } from "./zoom.ts";

export { manualClock, wallClock, type Clock } from "./clock.ts";
export { fakeDocumenso, type DocumensoProvider, type EsignEnvelope, type EsignProvider } from "./documenso.ts";
export { fakeGithub, type GithubIssue, type GithubProvider } from "./github.ts";
export { fakeGoogle, gmailListUrl, type GmailListPage, type GmailListQuery, type GoogleProvider } from "./google.ts";
export { fakeLlm, type LlmEvent, type LlmOptions, type LlmProvider, type LlmTurn } from "./llm.ts";
export { fakeMail, type MailMessage, type MailProvider } from "./mail.ts";
export { fakeMicrosoft, graphMessagesUrl, type GraphMessagePage, type MicrosoftProvider } from "./microsoft.ts";
export { ReplayMiss, handledFetch, hostIs, jsonResponse, loadReplay, recordingFetch, replayFetch } from "./replay.ts";
export type { FetchInit, FetchLike, FetchResponse, Handler, RecordedExchange, ReplayTape, SeenCall } from "./replay.ts";
export { fakeStripe, type StripeProvider } from "./stripe.ts";
export { TWILIO_ACCOUNT_SID, fakeTwilio, type TwilioProvider } from "./twilio.ts";
export { fakeZoom, type ZoomProvider } from "./zoom.ts";

export const PROVIDER_NAMES = ["llm", "mail", "twilio", "github", "google", "microsoft", "stripe", "documenso", "zoom"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export interface FakeProviderOptions {
  llm?: LlmOptions;
  tapes?: Partial<Record<ProviderName, ReplayTape>>;
}

export interface FakeProviders {
  llm: LlmProvider;
  mail: MailProvider;
  twilio: TwilioProvider;
  github: GithubProvider;
  google: GoogleProvider;
  microsoft: MicrosoftProvider;
  stripe: StripeProvider;
  documenso: DocumensoProvider;
  zoom: ZoomProvider;
  /** One fetch for every provider host. Recorded tapes win over the scripted handlers. */
  http: FetchLike;
}

const HOSTS: { suffix: string; name: ProviderName }[] = [
  { suffix: "googleapis.com", name: "google" },
  { suffix: "microsoft.com", name: "microsoft" },
  { suffix: "microsoftonline.com", name: "microsoft" },
  { suffix: "twilio.com", name: "twilio" },
  { suffix: "github.com", name: "github" },
  { suffix: "stripe.com", name: "stripe" },
  { suffix: "zoom.us", name: "zoom" },
  { suffix: "resend.com", name: "mail" },
  { suffix: "mailgun.net", name: "mail" },
  { suffix: "openai.com", name: "llm" },
  { suffix: "anthropic.com", name: "llm" },
  { suffix: "x.ai", name: "llm" },
  { suffix: "documenso.internal", name: "documenso" },
];

export function providerForHost(host: string): ProviderName | null {
  const h = host.toLowerCase().replace(/\.$/, "");
  for (const row of HOSTS) if (h === row.suffix || h.endsWith(`.${row.suffix}`)) return row.name;
  return null;
}

export function fakeProviders(opts: FakeProviderOptions = {}): FakeProviders {
  const tape = (name: ProviderName) => {
    const t = opts.tapes?.[name];
    return t ? { tape: t } : {};
  };
  const llm = fakeLlm(opts.llm ?? {});
  const mail = fakeMail(tape("mail"));
  const twilio = fakeTwilio(tape("twilio"));
  const github = fakeGithub(tape("github"));
  const google = fakeGoogle(tape("google"));
  const microsoft = fakeMicrosoft(tape("microsoft"));
  const stripe = fakeStripe(tape("stripe"));
  const documenso = fakeDocumenso(tape("documenso"));
  const zoom = fakeZoom(tape("zoom"));
  const byName: Record<ProviderName, { fetch: FetchLike }> = { llm, mail, twilio, github, google, microsoft, stripe, documenso, zoom };
  const http: FetchLike = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      throw new ReplayMiss(method, url);
    }
    const name = providerForHost(host);
    if (!name) throw new ReplayMiss(method, url);
    return byName[name].fetch(url, init);
  };
  return { llm, mail, twilio, github, google, microsoft, stripe, documenso, zoom, http };
}
