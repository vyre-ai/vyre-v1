// Shared steps of the personal mail journeys (test/mail.personal.*.live.test.ts): the guided setup in Settings and the Connect a mailbox sheet, as a person uses them.
import assert from "node:assert/strict";
import { open, shoot } from "./mail-browser.ts";
import type { Screens, Seat } from "./mail-browser.ts";

export const OUT = "shots-evidence/personal-mail";
export const CLIENT = { id: "e2e-client.apps.googleusercontent.com", secret: "e2e-client-secret-GOCSPX" };

/** Settings > Connections > Sign in with your own account: the guided panel, filled and saved. */
export async function guidedSetup(s: Screens, who: Seat, dir: string): Promise<void> {
  await open(who, s, "/settings");
  await who.page.getByTestId("row-page-connections").click();
  await who.page.getByTestId("signin-google").click();
  await who.page.getByTestId("row-signin.google.redirect").waitFor({ timeout: 15_000 });
  assert.ok((await who.page.getByTestId("row-signin.google.redirect").innerText()).includes(`${s.web.origin}/oauth/callback`), "the exact redirect address to register");
  await shoot(who.page, dir, "guided-setup");
  await who.page.getByTestId("signin-google-id").fill(CLIENT.id);
  await who.page.getByTestId("signin-google-id").press("Tab");
  await who.page.getByTestId("signin-google-secret").fill(CLIENT.secret);
  await who.page.getByTestId("signin-google-secret").press("Tab");
  await who.page.getByTestId("signin-google-save").click();
  await who.page.getByText(/Client e2e-client.* from #Google_Sign_In/).waitFor({ timeout: 15_000 });
  await shoot(who.page, dir, "app-saved");
}

/** The Connect a mailbox sheet on the Gmail tab, signed in as the account the fake Google is told about; returns once the sheet closes with the mailbox made. */
export async function signInThroughSheet(who: Seat, email: string, dir: string, step: string): Promise<void> {
  who.setEmail(email);
  await who.page.getByTestId("connect-signin").waitFor({ timeout: 15_000 });
  await shoot(who.page, dir, `${step}-sheet`);
  const popup = who.ctx.waitForEvent("page");
  await who.page.getByTestId("connect-signin").click();
  const approved = await popup;
  await approved.getByText("Account connected").waitFor({ timeout: 30_000 });
  await approved.close();
  await who.page.getByTestId("connect-signed-in").click();
  await who.page.getByTestId("connect-mailbox").waitFor({ state: "detached", timeout: 30_000 });
}
