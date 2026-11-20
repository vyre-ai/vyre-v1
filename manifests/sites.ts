// sites (lane L8): anything that runs in a Docker container behind Caddy, with staging, previews, promote and rollback (spec 2.20, 3.6, ARCH 7.6).
import {
  block,
  create,
  defineManifest,
  ev,
  list,
  outward,
  read,
  screen,
  t,
  write,
} from "../packages/contracts/src/index.ts";
import { id, pageIn, pageOut } from "./_common.ts";

// a site's id is shown by its example alone: the pattern repeats it on every tool that takes a site and the model is shown them all (the handlers look the site up and refuse an id that is not one)
const siteId = t.str({ examples: ["sit_a1b2c3"] });
// the same for a Vault handle, a folder and a file: the example shows the form, and the handlers (cleanSource, env_set) check it and refuse another
const handleIn = t.str({ examples: ["#Dana_Lawmatics"] });
const folderIn = t.str({ examples: ["fld_a1b2c3"] });
const fileIn = t.str({ examples: ["fil_a1b2c3"] });

const state = t.enm("queued", "building", "ready", "failed", "stopped");
const fix = t.enm(
  "set_env",
  "add_postgres",
  "add_redis",
  "retry",
  "set_start",
  "set_port",
  "open_logs",
  "connect_repo",
  "free_space",
  "more_memory",
);
const stepKey = t.enm("fetch", "build", "start", "check");
const stepState = t.enm("waiting", "running", "ok", "failed", "skipped");
const step = t.obj({
  key: stepKey,
  state: stepState,
  ms: t.opt(t.int({ description: "How long it took" })),
  startedAt: t.opt(t.ts({ description: "When it began, while it is running" })),
});
const dep = t.obj({
  deploymentId: t.id("dpl"),
  siteId,
  env: t.enm("staging", "preview", "production"),
  state,
  url: t.opt(t.str()),
  branch: t.opt(t.str()),
  commit: t.opt(t.str()),
  message: t.opt(t.str({ description: "The commit's first line" })),
  at: t.ts(),
  by: t.opt(t.str({ description: "Who started it: a person or agent id" })),
  note: t.opt(t.str({ description: "What was detected and how it runs, in one line" })),
  problem: t.opt(t.str({ description: "Why it failed, in plain words" })),
  fix: t.opt(fix),
  current: t.opt(t.bool()),
  finishedAt: t.opt(t.ts()),
  steps: t.opt(t.arr(step, { description: "Fetch, build, start and check, each with its state and time" })),
});
const access = t.enm("public", "password", "space", "private");
const hookOut = {
  enabled: t.bool(),
  url: t.opt(t.str({ description: "The payload URL to give GitHub" })),
  follow: t.arr(t.str(), { description: "Branches that get a preview" }),
  secret: t.opt(t.str({ description: "Shown once, to a person. Paste it into GitHub's webhook as the secret" })),
  vault: t.opt(t.str({ description: "For an agent: the Vault handle that holds the new secret" })),
  lastDeliveryAt: t.opt(t.ts()),
  failed: t.arr(t.obj({ branch: t.str(), action: t.str(), error: t.str(), at: t.ts() }), {
    description: "Pushes that could not run, newest first",
  }),
};
const envScope = t.enm("all", "production", "previews");
const envEntry = t.obj({
  name: t.str(),
  vaultHandle: t.opt(handleIn),
  value: t.opt(t.str()),
  scope: t.opt(envScope),
  confirmPlain: t.opt(t.bool()),
});
const shipEnv = t.obj({ name: t.str(), vaultHandle: t.opt(handleIn), value: t.opt(t.str()) });
const source = t.obj({
  repo: t.opt(t.str()),
  branch: t.opt(t.str()),
  tokenHandle: t.opt(handleIn),
  folderId: t.opt(folderIn),
  fileId: t.opt(fileIn),
  path: t.opt(t.str()),
  root: t.opt(t.str()),
});
const limits = t.obj({
  cpus: t.num(),
  memoryMb: t.int(),
  diskMb: t.opt(t.int()),
});
const addon = t.obj({
  kind: t.enm("postgres", "redis"),
  state: t.enm("starting", "ready", "failed"),
  envName: t.str({ examples: ["DATABASE_URL"] }),
  detail: t.opt(t.str()),
});
const siteRow = t.obj({
  siteId,
  name: t.str(),
  kind: t.enm("site", "app", "api", "worker", "artifact"),
  owner: t.str(),
  repoFolderId: t.opt(folderIn),
  stagingUrl: t.opt(t.str()),
  productionUrl: t.opt(t.str()),
  state,
  slug: t.opt(t.str({ description: "The name in the address: /p/<slug>" })),
  url: t.opt(t.str({ description: "Where it is served, once live" })),
  computerId: t.opt(id.computer),
  port: t.opt(t.int()),
  folderId: t.opt(folderIn),
  access: t.opt(access),
  live: t.opt(t.bool()),
  blocked: t.opt(t.bool()),
  updatedAt: t.opt(t.ts()),
  thumb: t.opt(t.str()),
  chatId: t.opt(t.str()),
  chatTitle: t.opt(t.str()),
  sharedWith: t.opt(t.arr(t.str())),
  sharedAudience: t.opt(t.arr(t.enm("link", "space"))),
  deployed: t.opt(t.bool()),
  source: t.opt(source),
  lastDeploy: t.opt(dep),
  limits: t.opt(limits),
  addons: t.opt(t.arr(addon)),
  autoDeploy: t.opt(t.bool()),
  passwordSet: t.opt(t.bool()),
});
const target = {
  computerId: t.opt(id.computer),
  port: t.opt(t.int({ minimum: 1, maximum: 65535 })),
  folderId: t.opt(folderIn),
};
const dnsRecord = t.obj({ type: t.enm("CNAME", "A"), name: t.str(), value: t.str() });
const deployTarget = { siteId };

export default defineManifest({
  id: "sites",
  title: "Sites",
  owner: "L8",
  events: [
    ev("site.created", "A site was created", {
      p: { siteId, name: t.str(), private: t.opt(t.bool()) },
      subject: ["site", "/siteId"],
    }),
    ev("site.access_changed", "Who may reach a site was changed (public, password, the Space, or private)", {
      p: { siteId, access },
      subject: ["site", "/siteId"],
    }),
    ev("site.published", "A site or artifact went live at its address", {
      p: { siteId, url: t.opt(t.str()), access },
      subject: ["site", "/siteId"],
    }),
    ev("site.stopped", "A site or artifact stopped being served", {
      p: { siteId },
      subject: ["site", "/siteId"],
    }),
    ev("site.build_failed", "A build failed", {
      p: { siteId, deploymentId: t.id("dpl"), reason: t.str() },
      subject: ["site", "/siteId"],
      notify: "run.failed",
    }),
    ev("site.deployed", "A deployment reached staging or a preview", {
      p: { siteId, deploymentId: t.id("dpl"), env: t.enm("staging", "preview") },
      subject: ["site", "/siteId"],
      replay: "stub",
      trigger: { title: "A site is deployed", fields: ["/env"] },
    }),
    ev("site.promoted", "A build was promoted to production through the Gate", {
      p: { siteId, deploymentId: t.id("dpl") },
      subject: ["site", "/siteId"],
      replay: "stub",
    }),
    ev("site.rolled_back", "Production was rolled back to an earlier build", {
      p: { siteId, toDeploymentId: t.id("dpl") },
      subject: ["site", "/siteId"],
      replay: "stub",
    }),
    ev("site.preview_created", "A preview was built for a branch or pull request", {
      p: { siteId, branch: t.str(), url: t.str() },
      subject: ["site", "/siteId"],
    }),
    ev("site.preview_removed", "A preview was removed after the branch merged", {
      p: { siteId, branch: t.str() },
      subject: ["site", "/siteId"],
    }),
    ev(
      "site.table_created",
      "A site table (site-scoped record type) was created; fields carries its columns so the record type can be made from the event alone",
      {
        p: {
          siteId,
          type: t.str(),
          fields: t.opt(t.arr(t.obj({ key: t.str(), type: t.str(), title: t.str() }))),
        },
        subject: ["site", "/siteId"],
      },
    ),
    ev("site.table_promoted", "A site table became a Space record type", {
      p: { siteId, type: t.str() },
      subject: ["site", "/siteId"],
    }),
    ev("site.domain_changed", "A site domain was set or removed", {
      p: { siteId, domain: t.str() },
      subject: ["site", "/siteId"],
    }),
  ],
  blocks: [
    block(
      "deploy",
      {
        siteId,
        deploymentId: t.id("dpl"),
        env: t.enm("staging", "preview", "production"),
        state,
        url: t.opt(t.str()),
        checks: t.arr(t.obj({ name: t.str(), ok: t.bool() })),
        canPromote: t.bool(),
      },
      "Deploy {{env}} is {{state}}: {{url}}",
      {
        actions: [
          { key: "promote", label: "Promote", cap: "sites.promote", input: { siteId: "/siteId" } },
          { key: "rollback", label: "Roll back", cap: "sites.rollback", input: { siteId: "/siteId" } },
        ],
        opens: { tab: "site", input: { siteId: "/siteId" } },
      },
    ),
    block("artifact", { artifactId: id.site, title: t.str() }, "Artifact: {{title}}", {
      opens: { tab: "artifact", input: { artifactId: "/artifactId" } },
    }),
  ],
  lists: [list("site", "Site", "Sites", "sites.list")],
  capabilities: [
    create(
      "sites.create",
      "Create a site: where it runs (a computer port or a Files folder) or its source (repo, folder or zip). Nothing is served until published or deployed",
      {
        in: {
          name: t.str(),
          kind: t.opt(t.enm("site", "app", "api", "worker", "artifact")),
          repoUrl: t.opt(t.str()),
          templateKit: t.opt(id.kit),
          slug: t.opt(t.str()),
          access: t.opt(access),
          source: t.opt(source),
          limits: t.opt(limits),
          ...target,
        },
        out: { site: siteRow },
        make: ["site", "/folderId"],
        gate: { act: "send", when: "vault.key_host_unapproved(input)" },
        perm: "sites.deploy",
        emits: ["site.created"],
        tool: "sites",
      },
    ),
    // not a tool: the host asks it before it asks for a deploy (the commit the branch is at, with the site's own token, and whether it was deployed)
    read("sites.head_check", "The commit a site's branch is at, and whether it was already deployed", {
      in: deployTarget,
      out: { head: t.opt(t.str()), changed: t.bool(), repo: t.opt(t.bool()), branch: t.opt(t.str()) },
      on: ["site", "/siteId"],
    }),
    read("sites.get", "Read one site", {
      in: deployTarget,
      out: { site: siteRow },
      on: ["site", "/siteId"],
      tool: "sites",
    }),
    read("sites.list", "List the sites and artifacts you can see, by section, kind, folder", {
      in: {
        section: t.opt(t.enm("personal", "shared", "space")),
        folderId: t.opt(folderIn),
        kind: t.opt(t.enm("site", "artifact")),
        ...pageIn,
      },
      out: { sites: t.arr(siteRow), ...pageOut },
      tool: "sites",
      label: "filter",
    }),
    write(
      "sites.update",
      "Change a site: name, source, CPU and memory, deploy on push, where it runs, who may reach it",
      {
        in: {
          siteId,
          name: t.opt(t.str()),
          settings: t.opt(t.rec()),
          access: t.opt(access),
          source: t.opt(source),
          limits: t.opt(limits),
          autoDeploy: t.opt(t.bool()),
          ...target,
          expectedUpdatedAt: t.opt(t.ts({ description: "The updatedAt you read; refused if changed since" })),
        },
        out: { site: siteRow },
        on: ["site", "/siteId"],
        gate: { act: "send", when: "vault.key_host_unapproved(input)" },
        perm: "sites.deploy",
        emits: ["site.access_changed"],
        tool: "sites",
        errors: ["validation.version_conflict"],
      },
    ),
    write("sites.publish", "Serve a non-public site: space or private access, or a password on its own domain", {
      in: deployTarget,
      out: { site: siteRow },
      on: ["site", "/siteId"],
      perm: "sites.deploy",
      emits: ["site.published"],
      tool: "sites",
    }),
    write("sites.stop", "Stop serving a site. Its address answers nothing", {
      in: deployTarget,
      out: { site: siteRow },
      on: ["site", "/siteId"],
      perm: "sites.deploy",
      emits: ["site.stopped"],
      tool: "sites",
    }),
    read("sites.status", "Is the port answering? Where it runs, the address, and what is wrong when something is", {
      in: deployTarget,
      out: { answering: t.bool(), detail: t.opt(t.str()), url: t.opt(t.str()), live: t.bool(), blocked: t.bool() },
      on: ["site", "/siteId"],
      tool: "sites",
    }),
    read(
      "sites.host",
      "What this Space can host: its address, whether Vyre can run apps here, the sites address, what a custom domain needs",
      {
        in: {},
        out: {
          origin: t.opt(t.str()),
          relay: t.bool(),
          computers: t.bool(),
          domains: t.bool(),
          domainsNeed: t.opt(t.str()),
          deploy: t.opt(t.bool()),
          deployNeed: t.opt(t.str()),
          sitesDomain: t.opt(
            t.str({ description: "Sites get <name>.<this> as their own address", examples: ["northwind.vyre.run"] }),
          ),
        },
        perm: null,
        level: "view",
        tool: "sites",
      },
    ),
    write("sites.delete", "Delete a site and stop its container", {
      in: deployTarget,
      out: { deleted: t.bool() },
      on: ["site", "/siteId"],
      level: "manage",
      perm: "sites.deploy",
      risk: "high",
      audit: "always",
      gate: { act: "delete", when: "actor.kind != 'person'" },
      tool: "sites",
    }),
    write("sites.build", "Build the site from its repo (the site agent runs in the repo); test and verify", {
      in: { siteId, branch: t.opt(t.str()) },
      out: { runId: id.run, deploymentId: t.id("dpl") },
      on: ["site", "/siteId"],
      perm: "sites.deploy",
      run: { kind: "build", stoppable: true },
      emits: ["site.build_failed", "site.preview_created", "site.deployed", "site.preview_removed"],
      tool: "sites",
      team: true,
    }),
    write(
      "sites.deploy",
      "Build the site from its source and run it here (Dockerfile, Node, Vite, Python, static). The last good build serves until the new one answers",
      {
        in: {
          siteId,
          source: t.opt(source),
          wait: t.opt(t.bool()),
          onlyIfChanged: t.opt(t.bool()),
          commit: t.opt(t.str()),
          fp: t.opt(t.str()),
        },
        out: { deployment: dep },
        on: ["site", "/siteId"],
        gate: { act: "deploy", when: "sites.deploy_gate(input)" },
        perm: "sites.deploy",
        emits: ["site.deployed", "site.build_failed", "site.preview_removed"],
        tool: "sites",
        audit: "sensitive",
        errors: ["validation.precondition_failed", "permission.no_grant"],
      },
    ),
    write(
      "sites.ship",
      "Put an app online in one call: create the site (or use siteId), set env, add databases, deploy, wait. Returns the address, or the failed step with its fix",
      {
        in: {
          siteId: t.opt(siteId),
          name: t.opt(t.str()),
          source: t.opt(source),
          env: t.opt(t.arr(shipEnv)),
          addons: t.opt(t.arr(t.enm("postgres", "redis"))),
          wait: t.opt(t.bool()),
        },
        out: {
          ok: t.bool(),
          siteId,
          address: t.opt(t.str()),
          say: t.str({ description: "What to tell the person" }),
          failedStep: t.opt(t.enm("setup", "deploy", "fetch", "build", "start", "check")),
          problem: t.opt(t.str()),
          fix: t.opt(fix),
          deployment: t.opt(dep),
        },
        perm: "sites.deploy",
        tool: "sites",
        gate: { act: "deploy", when: "vault.key_host_unapproved(input)" },
        audit: "sensitive",
        errors: ["validation.bad_input", "validation.precondition_failed", "permission.no_grant"],
      },
    ),
    read(
      "sites.webhook_get",
      "GitHub webhook of a site: on or off, its address, the branches that get a preview. The secret is never shown again",
      {
        in: deployTarget,
        out: hookOut,
        on: ["site", "/siteId"],
        tool: "sites",
      },
    ),
    write(
      "sites.webhook_set",
      "Turn the GitHub webhook on or off, rotate its secret (shown once), or set preview branches",
      {
        in: {
          siteId,
          enabled: t.opt(t.bool()),
          rotate: t.opt(t.bool()),
          follow: t.opt(t.arr(t.str())),
        },
        out: hookOut,
        on: ["site", "/siteId"],
        gate: { act: "send", when: "vault.key_host_unapproved(input)" },
        perm: "sites.deploy",
        tool: "sites",
        audit: "sensitive",
        errors: ["validation.precondition_failed", "validation.bad_input"],
      },
    ),
    write("sites.deploy_cancel", "Cancel the running deploy. The last good build keeps serving", {
      in: { siteId, deploymentId: t.opt(t.id("dpl")) },
      out: { deployment: dep },
      on: ["site", "/siteId"],
      perm: "sites.deploy",
      tool: "sites",
      audit: "sensitive",
      errors: ["validation.precondition_failed"],
    }),
    read("sites.deployments", "List deployments with state and URL", {
      in: { siteId, ...pageIn },
      out: { deployments: t.arr(dep), ...pageOut },
      on: ["site", "/siteId"],
      tool: "sites",
    }),
    read("sites.previews", "List previews (one per branch and pull request, on their own staging address)", {
      in: deployTarget,
      out: { previews: t.arr(dep) },
      on: ["site", "/siteId"],
      tool: "sites",
    }),
    write(
      "sites.preview_rebuild",
      "Build a branch of the repo as a preview at its own address behind sign-in. A new build replaces the last",
      {
        in: { siteId, branch: t.str(), wait: t.opt(t.bool()) },
        out: { deployment: dep },
        on: ["site", "/siteId"],
        perm: "sites.deploy",
        emits: ["site.preview_created", "site.build_failed", "site.deployed", "site.preview_removed"],
        tool: "sites",
        team: true,
      },
    ),
    write(
      "sites.preview_promote",
      "Serve a preview's build as production without a rebuild, with the production variables",
      {
        in: { siteId, branch: t.str(), wait: t.opt(t.bool()) },
        out: { deployment: dep },
        on: ["site", "/siteId"],
        gate: { act: "deploy", when: "vault.key_host_unapproved(input)" },
        perm: "sites.deploy",
        tool: "sites",
        audit: "sensitive",
        errors: ["validation.precondition_failed"],
      },
    ),
    write("sites.preview_remove", "Remove a preview", {
      in: { siteId, branch: t.str() },
      out: { removed: t.bool() },
      on: ["site", "/siteId"],
      perm: "sites.deploy",
      emits: ["site.preview_removed"],
      tool: "sites",
    }),
    outward("sites.promote", "Put a site on the public internet. Held for approval unless the person asked this turn", {
      in: { siteId },
      out: { site: siteRow },
      on: ["site", "/siteId"],
      perm: "sites.deploy",
      level: "edit",
      gate: { act: "site_promote", when: "actor.kind != 'person'" },
      emits: ["site.published", "site.promoted"],
      tool: "sites",
      errors: ["validation.precondition_failed"],
    }),
    outward("sites.rollback", "Serve an earlier build again (the previous, or the one named). Nothing is built", {
      in: { siteId, toDeploymentId: t.opt(t.id("dpl")) },
      out: { deployment: dep },
      on: ["site", "/siteId"],
      perm: "sites.deploy",
      level: "edit",
      gate: { act: "none", reason: "restores a build that was already served" },
      emits: ["site.rolled_back"],
      tool: "sites",
      errors: ["validation.precondition_failed"],
    }),
    create("sites.table_create", "Create a site table (a site-scoped record type)", {
      in: { siteId, key: t.str(), fields: t.arr(t.obj({ key: t.str(), type: t.str(), title: t.str() })) },
      out: { type: t.str() },
      on: ["site", "/siteId"],
      emits: ["site.table_created"],
      tool: "sites",
      level: "edit",
    }),
    read("sites.tables", "List site tables of a site", {
      in: deployTarget,
      out: { tables: t.arr(t.obj({ type: t.str(), rows: t.int() })) },
      on: ["site", "/siteId"],
      tool: "sites",
    }),
    write("sites.table_promote", "Promote a site table to a Space record type", {
      in: { siteId, type: t.str() },
      out: { type: t.str() },
      on: ["site", "/siteId"],
      perm: "schema.manage",
      level: "manage",
      emits: ["site.table_promoted"],
      tool: "sites",
      audit: "always",
    }),
    write(
      "sites.env_set",
      "Set a site's env vars (replaces the list): a Vault key, or a plain value (not a secret). scope: production (default), previews or all",
      {
        in: { siteId, entries: t.arr(envEntry) },
        out: { ok: t.bool() },
        on: ["site", "/siteId"],
        gate: { act: "deploy", when: "vault.key_host_unapproved(input)" },
        perm: "sites.deploy",
        tool: "sites",
        audit: "sensitive",
        errors: ["permission.no_grant"],
      },
    ),
    read(
      "sites.env_list",
      "A site's env var names and sources (never values), and names the app looks for that are not set",
      {
        in: deployTarget,
        out: {
          entries: t.arr(
            t.obj({
              name: t.str(),
              vaultName: t.str({ description: "The Vault key, empty for a plain value" }),
              injected: t.bool(),
              kind: t.enm("secret", "plain"),
              value: t.opt(t.str({ description: "Only for a plain value" })),
              scope: envScope,
            }),
          ),
          wanted: t.opt(t.arr(t.str())),
        },
        on: ["site", "/siteId"],
        tool: "sites",
      },
    ),
    read("sites.domains_get", "Site domains with the DNS check and the Caddy certificate state", {
      in: deployTarget,
      out: {
        domains: t.arr(t.obj({ domain: t.str(), dnsOk: t.bool(), certificate: t.enm("pending", "issued", "failed") })),
      },
      on: ["site", "/siteId"],
      tool: "sites",
    }),
    write("sites.domain_set", "Add or remove a site domain", {
      in: { siteId, domain: t.str(), remove: t.opt(t.bool()) },
      out: { dnsOk: t.bool() },
      on: ["site", "/siteId"],
      perm: "sites.domains",
      emits: ["site.domain_changed"],
      tool: "sites",
      team: true,
    }),
    create("sites.domain_add", "Add a custom domain: returns the DNS records to set; TLS is automatic", {
      in: { siteId, domain: t.str() },
      out: { domain: t.str(), records: t.arr(dnsRecord), state: t.enm("waiting_dns", "issuing", "live") },
      on: ["site", "/siteId"],
      perm: "sites.domains",
      emits: ["site.domain_changed"],
      tool: "sites",
      level: "edit",
    }),
    read("sites.domain_check", "The state of a custom domain: waiting for DNS, issuing the certificate, or live", {
      in: { siteId, domain: t.str() },
      out: { domain: t.str(), records: t.arr(dnsRecord), state: t.enm("waiting_dns", "issuing", "live") },
      on: ["site", "/siteId"],
      tool: "sites",
    }),
    create(
      "sites.artifact_publish",
      'Needs a title and exactly one of html, fileId, folderId, path or port. THE way to show what you made: publishes it privately, the person gets a card to open. Example: artifact_publish {"title":"Q3 plan","html":"<h1>Q3</h1>"}. Same title or artifactId updates the link. No title: its <title> is used',
      {
        in: {
          title: t.str(),
          html: t.opt(t.str()),
          fileId: t.opt(fileIn),
          folderId: t.opt(folderIn),
          path: t.opt(t.str()),
          port: t.opt(t.int({ minimum: 1, maximum: 65535 })),
          computerId: t.opt(id.computer),
          artifactId: t.opt(id.site),
          expectedUpdatedAt: t.opt(
            t.ts({
              description:
                "The updatedAt you read; a change made since then is not replaced, and the change is refused",
            }),
          ),
          thumb: t.opt(
            t.str({
              description:
                "A small picture of the page taken at publish, as a png, jpeg or webp data URL (about 120 by 80)",
            }),
          ),
        },
        out: {
          artifactId: id.site,
          url: t.opt(t.str()),
          updatedAt: t.opt(
            t.ts({
              description:
                "When the page was last published; send it back as expectedUpdatedAt to be told when someone else changed it first",
            }),
          ),
          updated: t.bool(),
          opened: t.bool({
            description:
              "True only when the person's app opened it in a tab. False: it is published and the chat card has Open; do not say it opened",
          }),
        },
        make: ["site", "/folderId"],
        perm: null,
        level: "view",
        mcpName: "artifact_publish",
        emits: ["site.created", "site.published"],
        tool: "sites",
        errors: ["validation.precondition_failed"],
      },
    ),
    write(
      "sites.artifact_open",
      "A short-lived address that opens an artifact for the person asking, in a tab or the browser",
      {
        in: { artifactId: id.site },
        out: { path: t.str(), url: t.opt(t.str()), expiresAt: t.ts(), checked: t.opt(t.bool()) },
        on: ["site", "/artifactId"],
        level: "view",
        tool: "sites",
      },
    ),
    write(
      "sites.artifact_thumb_set",
      "Keep a small picture of an artifact, sent by the Vyre for Chrome extension. Set only when there is none or the artifact changed",
      {
        in: { artifactId: id.site, thumb: t.str() },
        out: { set: t.bool() },
        on: ["site", "/artifactId"],
        level: "view",
        tool: "sites",
        offline: "online",
      },
    ),
    write(
      "sites.chat_viewing",
      "The app says a chat is open for the person (every 30 s while open). An artifact an agent publishes for that person opens in their app only while this holds",
      {
        in: { threadId: id.thread },
        out: { ok: t.bool() },
        on: ["thread", "/threadId"],
        level: "view",
        tool: "sites",
        offline: "online",
      },
    ),
    write(
      "sites.staging_password_set",
      "Choose the sealed Vault key that protects staging (shared across a site previews)",
      {
        in: { siteId, vaultHandle: handleIn },
        out: { ok: t.bool() },
        on: ["site", "/siteId"],
        perm: "sites.deploy",
        tool: "sites",
      },
    ),
    read("sites.service_identity", "The site service identity and its grants (capped by the owner)", {
      in: deployTarget,
      out: { principal: t.str(), grants: t.arr(t.obj({ resource: t.str(), level: t.str() })) },
      on: ["site", "/siteId"],
      tool: "sites",
    }),
    read("sites.logs", "A site's log: its app, or with build a deploy's build log. Text from the site", {
      in: { siteId, deploymentId: t.opt(t.id("dpl")), tail: t.opt(t.int()), build: t.opt(t.bool()) },
      out: {
        lines: t.arr(t.str()),
        state: t.opt(state),
        steps: t.opt(
          t.arr(
            t.obj({
              key: stepKey,
              state: stepState,
              ms: t.opt(t.int()),
              startedAt: t.opt(t.ts()),
              from: t.opt(t.int({ description: "The index in lines where this step's lines begin" })),
            }),
            { description: "With a build log: its steps" },
          ),
        ),
      },
      on: ["site", "/siteId"],
      perm: "sites.deploy",
      tool: "sites",
    }),
    read(
      "sites.plan",
      "What a deploy would do with this source: how it builds and starts, the port, and the databases and env names it looks for",
      {
        in: { siteId: t.opt(siteId), source: t.opt(source) },
        out: {
          kind: t.str(),
          note: t.str(),
          build: t.opt(t.str()),
          start: t.opt(t.str()),
          port: t.opt(t.int()),
          needs: t.arr(t.enm("postgres", "redis")),
          env: t.arr(t.str()),
          from: t.arr(t.str()),
        },
        gate: { act: "send", when: "vault.key_host_unapproved(input)" },
        perm: "sites.deploy",
        tool: "sites",
        errors: ["validation.precondition_failed"],
      },
    ),
    create(
      "sites.addon_add",
      "Give a site its own Postgres or Redis (DATABASE_URL or REDIS_URL). Its data survives redeploys",
      {
        in: { siteId, kind: t.enm("postgres", "redis") },
        out: { addon },
        on: ["site", "/siteId"],
        perm: "sites.deploy",
        level: "edit",
        tool: "sites",
        errors: ["validation.precondition_failed"],
      },
    ),
    write("sites.addon_remove", "Remove a site's Postgres or Redis and its data", {
      in: { siteId, kind: t.enm("postgres", "redis") },
      out: { removed: t.bool() },
      on: ["site", "/siteId"],
      perm: "sites.deploy",
      level: "manage",
      risk: "high",
      audit: "always",
      gate: { act: "delete", when: "actor.kind != 'person'" },
      tool: "sites",
    }),
    write(
      "sites.db_import",
      "Copy a Postgres into the site's own: a pg_dump file in Files, or a Vault key with the old connection string",
      {
        in: { siteId, fileId: t.opt(fileIn), fromHandle: t.opt(handleIn) },
        out: { ok: t.bool(), detail: t.str() },
        on: ["site", "/siteId"],
        perm: "sites.deploy",
        level: "edit",
        audit: "sensitive",
        tool: "sites",
        errors: ["validation.precondition_failed"],
      },
    ),
    write("sites.password_set", "Set the password for a site whose access is password (kept as a hash)", {
      in: { siteId, password: t.str({ minLength: 8, maxLength: 200 }) },
      out: { ok: t.bool() },
      on: ["site", "/siteId"],
      perm: "sites.deploy",
      audit: "sensitive",
    }),
    write(
      "sites.signin_link",
      "A short-lived link that signs the person asking in to a Space-only site at its own address",
      {
        in: { siteId, next: t.opt(t.str()) },
        out: { url: t.str(), expiresAt: t.ts() },
        on: ["site", "/siteId"],
      },
    ),
  ],
  screens: [
    screen("apps.sites", "apps", "ui:SitesList", {
      q: { sites: ["sites.list", { section: "/section", folderId: "/folder" }] },
      a: { promote: ["sites.promote", { siteId: "/selected" }, "Put this site on the public internet?"] },
      empty: "No sites yet",
      primary: "New site",
      needs: ["sites.deploy"],
    }),
    screen("apps.artifacts", "apps", "ui:Artifacts", {
      q: { artifacts: ["sites.list", { kind: "/kind" }] },
      empty: "Nothing made yet",
    }),
    screen("apps.site-editor", "apps", "ui:SiteEditor", {
      slot: "main",
      q: {
        site: ["sites.get", { siteId: "/selected" }],
        status: ["sites.status", { siteId: "/selected" }],
        domains: ["sites.domains_get", { siteId: "/selected" }],
      },
      a: { stop: ["sites.stop", { siteId: "/selected" }, "Stop serving this site?"] },
      ask: {
        suggestions: {
          view: ["Explain this site"],
          edit: ["Change the hero text", "Add a contact form"],
          manage: ["Put this site live"],
        },
      },
    }),
  ],
});
