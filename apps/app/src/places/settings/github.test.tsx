// Settings > GitHub: not connected is one button; connected shows the account, where Vyre can work, what agents may do and what used it; each control calls github.me.*.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsDataProvider } from "./data.tsx";
import { SettingsPlace } from "./SettingsPlace.tsx";
import { GH_PERMS, appLine, consumerWords, installWords } from "./GithubPage.tsx";
import { createSampleSettings, harbor, northwind } from "./sample.ts";

const html = (s: ReturnType<typeof createSampleSettings>, page = "github"): string => renderToStaticMarkup(<SettingsDataProvider value={s.data}><SettingsPlace width={1280} initialPage={page as never} /></SettingsDataProvider>).replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");

test("the page list is Profile, Your AI, GitHub, Notifications, Appearance, This device, Privacy and security, each with its sentence", () => {
  const out = html(createSampleSettings(northwind));
  const at = (t: string): number => { const i = out.indexOf(`>${t}<`); assert.ok(i >= 0, t); return i; };
  const order = ["Profile", "Your AI", "GitHub", "Notifications", "Appearance", "This device", "Privacy and security"].map(at);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(out.includes("One GitHub connection that every model and feature in Vyre uses."));
  for (const gone of ["row-page-connected", "row-page-mail", "row-page-memory", "row-page-skills", "row-page-about", "row-page-notes"]) assert.ok(!out.includes(`data-testid="${gone}"`), gone);
});

test("old addresses land on the page that holds them", () => {
  for (const [old, want] of [["memory", "page-profile"], ["notes", "page-ai"], ["skills", "page-ai"], ["about", "page-computer"], ["connected", "moved-vault"], ["mail", "moved-inbox"]] as const) {
    assert.ok(html(createSampleSettings(northwind), old).includes(`data-testid="${want}"`), `${old} -> ${want}`);
  }
});

test("connected: the account, the reconnect banner, orgs with Install or Change, six permissions and what used it", () => {
  const out = html(createSampleSettings(northwind));
  for (const n of ["@irfad7","Signs you in to Vyre","the Vyre GitHub app","github-reconnect","uses its own GitHub app. Reconnect once.","All repos","2 repos","Not installed","gh-org-irfad7","Opened a pull request","Crews"]) assert.ok(out.includes(n), n);
  assert.ok(out.includes("@irfad7") && out.includes("Signs you in to Vyre") && out.includes("the Vyre GitHub app"));
  assert.ok(out.includes('data-testid="github-reconnect"') && out.includes("uses its own GitHub app. Reconnect once."));
  assert.ok(out.includes("All repos") && out.includes("2 repos") && out.includes("Not installed"));
  assert.ok(out.includes('data-testid="gh-org-irfad7"') && !out.includes('data-testid="gh-org-northwind"'), "an org with no link has no button");
  for (const p of GH_PERMS) assert.ok(out.includes(`data-testid="gh-perm-${p.key}"`), p.key);
  assert.ok(out.includes("Opened a pull request") && out.includes("Crews"));
});

test("not connected: one button", () => {
  const out = html(createSampleSettings(harbor));
  assert.ok(out.includes("Connect GitHub once") && out.includes('data-testid="gh-connect"') && !out.includes('data-testid="github-account"'));
});

test("not connected: the line above Connect says which GitHub app the Space uses, the Vyre one or its own", () => {
  assert.equal(appLine("vyre"), "Your Space uses the Vyre GitHub app.");
  assert.equal(appLine("space"), "Your Space uses its own GitHub app.");
  const out = html(createSampleSettings(harbor));
  assert.ok(out.includes("Your Space uses the Vyre GitHub app.") && out.indexOf("Your Space uses the Vyre GitHub app.") < out.indexOf('data-testid="gh-connect"'), "the line comes first");
  const own = renderToStaticMarkup(<SettingsDataProvider value={createSampleSettings(harbor).data}><SettingsPlace width={1280} initialPage={"github" as never} /></SettingsDataProvider>);
  assert.ok(own.includes("Your Space uses"), "drawn for a member who is not connected");
});

test("each control calls its capability", async () => {
  const s = createSampleSettings(northwind);
  const c = (await s.data.call("github.me.connect", {})) as { authUrl: string };
  assert.ok(c.authUrl.startsWith("https://github.com/"));
  await s.data.call("github.me.policy.set", { policy: { merge: "ask" } });
  assert.equal(((await s.data.call("github.me.policy.get", {})) as { policy: { merge: string } }).policy.merge, "ask");
  await s.data.call("github.me.disconnect", {});
  assert.equal(((await s.data.call("github.me.status", {})) as { connected: boolean }).connected, false);
});

test("words: installs, consumers and the order of the permissions", () => {
  assert.equal(installWords({ install: "all" }, 9), "All repos");
  assert.equal(installWords({ install: "selected" }, 1), "1 repo");
  assert.equal(installWords({ install: "none" }, 0), "Not installed");
  assert.equal(consumerWords("ci"), "CI");
  assert.equal(consumerWords("something.else"), "something.else");
  assert.deepEqual(GH_PERMS.map((p) => p.label), ["Read code", "Push branches", "Push to main", "Open pull requests", "Comment", "Merge"]);
});
