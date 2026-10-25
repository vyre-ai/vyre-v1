// github module entry (lane L5). The host serves the generated stubs while manifests/github.ts says `status: 'stub'`; the flip to live is a one-line edit to host/modules.json
// (ruling 25) once P-CI_02 has landed. The host registers its half once at boot with setGithubHost (the App JWT, Vault writes, the filler, the public address): see projections.ts.
// verifyWebhook is what the host's /hooks/github route calls first: it refuses a body GitHub did not sign and returns the input of github.receive_webhook.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";

export { setGithubHost } from "./projections.ts";
export type { GithubHost } from "./projections.ts";
export { parseDelivery, signatureMatches, signatureOf, verifyWebhook } from "./handlers/index.ts";

export const handlers: Record<string, Handler> = {
  "github.app.create_manifest": (ctx, i) => h.appCreateManifest(ctx, i),
  "github.app.complete": (ctx, i) => h.appComplete(ctx, i),
  "github.app.get": (ctx) => h.appGet(ctx),
  "github.installations.list": (ctx) => h.installationsList(ctx),
  "github.repos.list": (ctx, i) => h.reposList(ctx, i),
  "github.repo.get": (ctx, i) => h.repoGet(ctx, i),
  "github.branches.list": (ctx, i) => h.branchesList(ctx, i),
  "github.installation_token": (ctx, i) => h.installationToken(ctx, i),
  "github.health": (ctx) => h.health(ctx),
  "github.pull_request.get": (ctx, i) => h.prGet(ctx, i),
  "github.pull_request.list_files": (ctx, i) => h.prListFiles(ctx, i),
  "github.pull_request.diff": (ctx, i) => h.prDiff(ctx, i),
  "github.pull_request.checks": (ctx, i) => h.prChecks(ctx, i),
  "github.pull_request.create": (ctx, i) => h.prCreate(ctx, i),
  "github.pull_request.update": (ctx, i) => h.prUpdate(ctx, i),
  "github.pull_request.comment": (ctx, i) => h.prComment(ctx, i),
  "github.pull_request.request_review": (ctx, i) => h.prRequestReview(ctx, i),
  "github.pull_request.merge": (ctx, i) => h.prMerge(ctx, i),
  "github.pull_request.close": (ctx, i) => h.prClose(ctx, i),
  "github.pull_request.rerun_checks": (ctx, i) => h.prRerunChecks(ctx, i),
  "github.pull_request.ask_author_fix": (ctx, i) => h.prAskAuthorFix(ctx, i),
  "github.issue.get": (ctx, i) => h.issueGet(ctx, i),
  "github.issue.create": (ctx, i) => h.issueCreate(ctx, i),
  "github.issue.update": (ctx, i) => h.issueUpdate(ctx, i),
  "github.issue.comment": (ctx, i) => h.issueComment(ctx, i),
  "github.issue.close": (ctx, i) => h.issueClose(ctx, i),
  "github.issue.assign_agent": (ctx, i) => h.issueAssignAgent(ctx, i),
  "github.receive_webhook": (ctx, i) => h.receiveWebhook(ctx, i),
};

export const projections = { inline: {}, consumers: {} };
