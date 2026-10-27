// Join screens (spec 3.13, ARCH 7.13): the rules, the stage machine from the invite to the finish, every page rendered in both modes, and the first-run checklist.
// Screens render with react-dom/server over react-native-web (ruling 28). A flat, one-column pattern: no gradients, blurs or split panes.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Checklist } from "./Checklist.tsx";
import { HalftoneField, syncHalftoneCanvasSize } from "./HalftoneField.tsx";
import { JoinFlow, makeRecoveryCode } from "./JoinFlow.tsx";
import { aiOptions } from "./ConnectAI.tsx";
import { DARK, LIGHT, paletteOf } from "./palette.ts";
import { RUN_STEPS, createSpaceResolutionGate, initialState, meter, normalizeSpaceAddress, reduce, resolveSpaceInvite, signInValid, strength, suggestions, usernameOk, valid, welcomeGreeting } from "./logic.ts";
import type { Action, FlowState, JoinInvite } from "./logic.ts";
import { Shell } from "../shell/spaces/Shell.tsx";
import { createSampleShell, samplePlace } from "../shell/spaces/sample.tsx";

const INVITE: JoinInvite = {
  space: "Northwind", host: "northwind", by: "Irfad Imtiaz", role: "Member", email: "irfad@northwind.example", names: { first: "Dana", last: "Whitfield" }, deviceName: "Dana's MacBook",
  starting: { agents: ["Intake", "Billing"], projects: ["Rivera matter"] }, sso: ["Google", "Okta"], github: true, adminKey: true,
};
const TAKEN = ["irfad", "maya", "admin"];
const rules = { isTaken: (u: string) => TAKEN.includes(u) };
const step = (s: FlowState, ...actions: Action[]): FlowState => actions.reduce((acc, a) => reduce(acc, a, rules), s);
const html = (initial: Partial<FlowState>, extra: Partial<Parameters<typeof JoinFlow>[0]> = {}, mode: "light" | "dark" = "light"): string =>
  renderToStaticMarkup(<JoinFlow invite={INVITE} initial={initial} isTaken={rules.isTaken} hold mode={mode} {...extra} />);
/** The opening tag that carries a test id. */
const tagOf = (out: string, id: string): string => out.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
const FILLED = { user: "dana", pw: "harbor-lamp-ninety", pw2: "harbor-lamp-ninety" };

test("password strength, usernames and suggestions follow the rules", () => {
  assert.deepEqual(["", "abc", "abcdefgh", "Abcdefgh1234", "Correct-horse-battery-staple"].map(strength), [0, 0, 1, 3, 4]);
  assert.deepEqual([0, 1, 2, 3, 4].map(meter), [0, 1, 2, 3, 3]);
  for (const ok of ["dana", "d.whit", "a_b-c9"]) assert.ok(usernameOk(ok), ok);
  for (const bad of ["ab", "1dana", "Dana", "has space", "x".repeat(25)]) assert.ok(!usernameOk(bad), bad);
  assert.deepEqual(suggestions("Dana", "Whitfield", "irfad", (u) => !TAKEN.includes(u)), ["dana.whitfield", "danaw", "dana-ops"]);
  assert.deepEqual(suggestions("", "", "x", () => true), []);
  assert.deepEqual(suggestions("Maya", "Chen", "maya", (u) => u !== "maya.chen"), ["mayac", "maya-ops"]);
});

test("Space addresses require HTTPS outside explicit local development", () => {
  assert.equal(normalizeSpaceAddress(" northwind.example "), "https://northwind.example");
  assert.equal(normalizeSpaceAddress("HTTPS://Northwind.Example/path/"), "https://northwind.example/path");
  assert.equal(normalizeSpaceAddress("http://localhost:3000/"), "http://localhost:3000");
  assert.equal(normalizeSpaceAddress("http://127.0.0.1:3000/"), "http://127.0.0.1:3000");
  assert.equal(normalizeSpaceAddress("http://[::1]:3000/"), "http://[::1]:3000");
  for (const address of ["", "http://northwind.example", "tauri://localhost", "file:///Users/irfad", "vyre://join", "mailto:hello@example.com"]) {
    assert.equal(normalizeSpaceAddress(address), null, address);
  }
});

test("the Welcome greeting is deterministic for morning, afternoon, and evening", () => {
  assert.equal(welcomeGreeting(0), "Good morning");
  assert.equal(welcomeGreeting(12), "Good afternoon");
  assert.equal(welcomeGreeting(18), "Good evening");
});

test("the connect reducer owns the address, failure, and distinct resolved destinations", () => {
  let s = initialState(INVITE, { stage: "connect" });
  s = step(s, { t: "set", patch: { spaceAddress: "northwind.example" } });
  assert.equal(s.spaceAddress, "northwind.example");
  s = step(s, { t: "space_resolving", intent: "signin" });
  assert.equal(s.spaceResolving, true);
  s = step(s, { t: "space_failed", message: "Could not verify this Space." });
  assert.deepEqual([s.spaceResolving, s.spaceError], [false, "Could not verify this Space."]);
  s = step(s, { t: "space_resolving", intent: "signin" }, { t: "space_resolved" });
  assert.equal(s.stage, "signin");
  s = step(initialState(INVITE, { stage: "connect" }), { t: "space_resolving", intent: "onboarding" }, { t: "space_resolved" });
  assert.equal(s.stage, "accept");
});

test("a Space resolver receives only the normalized address and must return before credentials can open", async () => {
  const calls: string[] = [];
  const resolved = resolveSpaceInvite(" Northwind.Example ", async (address) => {
    calls.push(address);
    return INVITE;
  });
  assert.deepEqual(calls, ["https://northwind.example"], "the connection begins with a normalized address");
  assert.equal(await resolved, INVITE, "the verified invite arrives asynchronously");
  await assert.rejects(resolveSpaceInvite("tauri://localhost", async () => INVITE), /valid https/i);
});

test("editing a Space address invalidates its stale deferred response and lets the new address resolve", async () => {
  let releaseA!: (invite: JoinInvite) => void;
  let releaseB!: (invite: JoinInvite) => void;
  let releaseUnmounted!: (invite: JoinInvite) => void;
  const a = new Promise<JoinInvite>((resolve) => { releaseA = resolve; });
  const b = new Promise<JoinInvite>((resolve) => { releaseB = resolve; });
  const unmounted = new Promise<JoinInvite>((resolve) => { releaseUnmounted = resolve; });
  const gate = createSpaceResolutionGate();
  let invite = INVITE;
  let stage: "connect" | "signin" = "connect";
  const commit = (request: number, resolved: JoinInvite): void => {
    if (!gate.isCurrent(request)) return;
    invite = resolved;
    stage = "signin";
  };
  const requestA = gate.begin();
  void a.then((resolved) => commit(requestA, resolved));
  gate.invalidate();
  releaseA({ ...INVITE, space: "Alpha" });
  await a;
  assert.deepEqual([invite.space, stage], ["Northwind", "connect"], "editing to Space B prevents stale Space A from opening credentials");
  const requestB = gate.begin();
  void b.then((resolved) => commit(requestB, resolved));
  releaseB({ ...INVITE, space: "Beta" });
  await b;
  assert.deepEqual([invite.space, stage], ["Beta", "signin"], "the edited Space can resolve after invalidating the old request");
  const requestUnmounted = gate.begin();
  void unmounted.then((resolved) => commit(requestUnmounted, resolved));
  gate.dispose();
  releaseUnmounted({ ...INVITE, space: "Gone" });
  await unmounted;
  assert.equal(invite.space, "Beta", "unmounted flows never commit a verified Space");
});

test("a fresh connection starts at the one-column Welcome back screen before credentials", () => {
  const out = html({ stage: "connect" });
  for (const text of ["Welcome back", "Connect a Space", "Space address", "Sign in", "Get started"]) assert.ok(out.includes(text), text);
  assert.match(out, /data-testid="space-address"/);
  assert.doesNotMatch(out, /Sign in to Northwind/, "credentials wait for a verified Space");
  assert.equal(out.match(/data-testid="join-panel"/g)?.length, 1);
  assert.equal(out.match(/data-testid="step-/g)?.length, 1);
});

test("auth-only halftone gives Welcome its full field and keeps forms calm", () => {
  const welcome = html({ stage: "connect" });
  const form = html({ stage: "signin" });
  const still = renderToStaticMarkup(<HalftoneField intensity="calm" reducedMotion />);
  assert.equal(welcome.match(/data-testid="auth-halftone"/g)?.length, 1);
  assert.match(welcome, /data-intensity="full"/);
  assert.match(form, /data-testid="auth-halftone"[^>]*data-intensity="calm"/);
  assert.match(still, /data-static="true"/);
});

test("the static halftone resizes its backing canvas for viewport and display changes", () => {
  const canvas = { width: 0, height: 0 };
  assert.equal(syncHalftoneCanvasSize(canvas, 390, 844, 1), true);
  assert.deepEqual(canvas, { width: 390, height: 844 });
  assert.equal(syncHalftoneCanvasSize(canvas, 390, 844, 1), false, "an unchanged canvas is not repainted");
  assert.equal(syncHalftoneCanvasSize(canvas, 844, 390, 2), true, "resize and device-pixel ratio changes repaint the static field");
  assert.deepEqual(canvas, { width: 1688, height: 780 });
});

test("the signed-in shell has no auth halftone", () => {
  const shell = renderToStaticMarkup(<Shell hub={createSampleShell()} renderPlace={samplePlace} />);
  assert.doesNotMatch(shell, /auth-halftone/);
});

test("each step enables Continue only when it can go on", () => {
  const s0 = step(initialState(INVITE), { t: "web" });
  assert.equal(s0.stage, "steps");
  assert.equal(valid(s0, rules), true, "names come from the invite");
  assert.equal(valid({ ...s0, last: " " }, rules), false);
  const s1 = { ...s0, step: 1 as const };
  assert.equal(valid({ ...s1, ...FILLED }, rules), true);
  assert.equal(valid({ ...s1, ...FILLED, user: "irfad" }, rules), false, "a taken username");
  assert.equal(valid({ ...s1, ...FILLED, pw2: "different" }, rules), false, "passwords differ");
  assert.equal(valid({ ...s1, ...FILLED, pw: "short", pw2: "short" }, rules), false, "too weak");
  const s2 = { ...s0, step: 2 as const, device: "Dana's MacBook" };
  assert.equal(valid(s2, rules), true);
  assert.equal(valid({ ...s2, rec: true, saved: false }, rules), false, "a recovery code that was made must be saved");
  assert.equal(valid({ ...s2, rec: true, saved: true }, rules), true);
  assert.equal(valid({ ...s2, device: " " }, rules), false);
  const s3 = { ...s0, step: 3 as const };
  assert.equal(valid({ ...s3, ai: "admin" }, rules), true);
  assert.equal(valid({ ...s3, ai: "none" }, rules), true, "Not now is allowed");
  assert.equal(valid({ ...s3, ai: "key", key: "sk-1" }, rules), false);
  assert.equal(valid({ ...s3, ai: "key", key: "sk-long-enough" }, rules), true);
  assert.equal(valid({ ...s3, ai: "sub", note: "" }, rules), false);
  assert.equal(valid({ ...s3, ai: "sub", note: "subok" }, rules), true);
});

test("the journey: invite landing, four steps, setup, finish; Back returns and Escape-style back leaves the steps", () => {
  let s = initialState(INVITE);
  assert.equal(s.stage, "accept");
  assert.equal(s.ai, "admin", "the admin's key is the default when there is one");
  s = step(s, { t: "web" });
  s = step(s, { t: "next" });
  assert.equal(s.step, 1);
  assert.equal(step(s, { t: "next" }).step, 1, "Continue does nothing while the step is not valid");
  s = step(s, { t: "set", patch: FILLED }, { t: "next" });
  assert.equal(s.step, 2);
  s = step(s, { t: "recovery_open", code: "K7QM-4TXD-92HB-WPLE" });
  assert.deepEqual([s.sheet, s.rec, s.code], [true, "new", "K7QM-4TXD-92HB-WPLE"]);
  assert.equal(step(s, { t: "next" }).step, 2, "the sheet blocks Continue");
  assert.equal(step(s, { t: "recovery_done" }).sheet, true, "Done needs the box ticked");
  s = step(s, { t: "recovery_close" });
  assert.deepEqual([s.sheet, s.rec, s.saved], [false, false, false], "Cancel on a code that was not saved forgets it");
  s = step(s, { t: "recovery_open", code: "NEWC-ODE0" });
  assert.equal(s.code, "NEWC-ODE0");
  s = step(s, { t: "set", patch: { saved: true } }, { t: "recovery_done" });
  assert.deepEqual([s.sheet, s.rec], [false, true]);
  s = step(s, { t: "next" });
  assert.equal(s.step, 3);
  assert.equal(step(s, { t: "back" }).step, 2);
  s = step(s, { t: "pick_ai", ai: "none" }, { t: "next" });
  assert.equal(s.stage, "run");
  const total = RUN_STEPS("Northwind").length;
  assert.equal(total, 4);
  for (let i = 0; i < total + 2; i++) s = step(s, { t: "run_tick", total });
  assert.equal(s.run, total, "the run never passes its last line");
  s = step(s, { t: "run_done" });
  assert.equal(s.stage, "done");
  // a failed join goes back to the last step with the reason
  const failed = step({ ...s, stage: "run" }, { t: "failed", message: "That username was taken a moment ago." });
  assert.deepEqual([failed.stage, failed.step, failed.error], ["steps", 3, "That username was taken a moment ago."]);
  assert.equal(step(initialState(INVITE), { t: "back" }).stage, "accept");
  assert.equal(step(step(initialState(INVITE), { t: "web" }), { t: "back" }).stage, "accept", "Back from the first step returns to the landing");
});

test("sign-in goes username and password, then the code, then in; Back unwinds", () => {
  let s = step(initialState(INVITE), { t: "signin" });
  assert.equal(s.stage, "signin");
  assert.equal(signInValid(s), false);
  s = step(s, { t: "set", patch: { siUser: "dana", siPw: "pw" } });
  assert.equal(signInValid(s), true);
  s = step(s, { t: "next" });
  assert.equal(s.si, "totp");
  assert.equal(signInValid(s), false);
  assert.equal(signInValid({ ...s, siCode: "12345" }), false);
  assert.equal(signInValid({ ...s, siCode: "123456" }), true);
  assert.equal(step(s, { t: "back" }).si, "pw");
  assert.equal(step(step(s, { t: "back" }), { t: "back" }).stage, "accept");
  assert.equal(step({ ...s, siCode: "123456" }, { t: "next" }).stage, "done");
});

test("the invite landing offers the app, the download, the browser and sign-in, and a join of a name only", () => {
  const out = html({});
  for (const text of ["Join Northwind", "Irfad Imtiaz invited you to join as a Member.", "Open in Vyre", "Download Vyre", "Mac, Windows, Linux", "Continue in the browser", "Already have an account?", "Sign in"]) {
    assert.ok(out.includes(text), text);
  }
  assert.equal(out.match(/data-testid="step-accept"/g)?.length, 1);
  assert.doesNotMatch(out, /data-testid="join-bar"/, "the landing has no Back and Continue bar");
});

test("step 1: welcome, name and photo, what the person starts with", () => {
  const out = html({ stage: "steps", step: 0 });
  for (const text of ["Welcome to Northwind", "Irfad Imtiaz invited you to join.", "First name", "Last name", "You&#x27;ll start with", "Intake, Billing", "Rivera matter", "Change photo"]) {
    assert.ok(out.includes(text) || out.includes(text.replace("&#x27;", "'")), text);
  }
  assert.match(out, /value="Dana"/);
  assert.match(out, /value="Whitfield"/);
  assert.match(out, /data-testid="dots"/);
  assert.match(out, /aria-label="Step 1 of 4"/);
  assert.match(out, /Continue/);
  const bare = renderToStaticMarkup(<JoinFlow invite={{ ...INVITE, starting: undefined }} initial={{ stage: "steps", step: 0 }} hold />);
  assert.doesNotMatch(bare, /start with/, "no section when the invite names nothing");
});

test("step 2: the username at the Space address, the strength meter and the messages", () => {
  const ok = html({ stage: "steps", step: 1, ...FILLED });
  for (const text of ["Your sign-in", "Username", "@", ".northwind", "Password", "Confirm", "Vyre never sees your password"]) assert.ok(ok.includes(text), text);
  assert.match(ok, /data-testid="username-ok"/);
  assert.match(ok, /aria-label="Password strength 3 of 3"/);
  const taken = html({ stage: "steps", step: 1, ...FILLED, user: "irfad" });
  assert.match(taken, /@irfad is taken\./);
  assert.match(taken, /data-testid="suggest-dana.whitfield"/);
  assert.doesNotMatch(taken, /data-testid="username-ok"/);
  const mism = html({ stage: "steps", step: 1, ...FILLED, pw2: "nope" });
  assert.match(mism, /Make both passwords match to continue\./);
  assert.match(html({ stage: "steps", step: 1, user: "9x" }), /Use 3 to 24 letters or digits, starting with a letter\./);
});

test("the clean account form keeps the approved promise, useful guidance, and local password controls", () => {
  const create = html({ stage: "steps", step: 1, ...FILLED });
  const signIn = html({ stage: "signin", si: "pw" });
  assert.match(create, /Your space, your username and your password\. That is all it takes, on any device\./);
  assert.match(create, /data-testid="password-visibility"/);
  assert.match(create, />Show</);
  assert.match(signIn, /data-testid="si-password-visibility"/);
  assert.match(signIn, />Show</);
  assert.match(create, /Keep your recovery code somewhere safe\. You need it to recover your private items after a password reset\./);
  assert.match(html({ stage: "steps", step: 1, ...FILLED, pw2: "nope" }), /Make both passwords match to continue\./);
});

test("auth choices stay distinct and every phone row has a 44px touch target", () => {
  const signIn = html({ stage: "signin", si: "pw" });
  const ai = html({ stage: "steps", step: 3, ...FILLED });
  assert.match(signIn, /data-testid="sign-in-sso"/);
  assert.match(signIn, /data-testid="sign-in-github"/);
  assert.doesNotMatch(tagOf(signIn, "sign-in-sso"), /GitHub/);
  assert.match(signIn, /height:44px/);
  assert.match(ai, /min-height:56px/);
});

test("step 3: this device, and the recovery code sheet with the code and the box", () => {
  const dev = html({ stage: "steps", step: 2, ...FILLED });
  for (const text of ["Set up this device", "Device name", "Trust this device", "Recovery code", "Create…"]) assert.ok(dev.includes(text), text);
  assert.match(dev, /role="switch"/);
  assert.doesNotMatch(dev, /data-testid="join-sheet"/);
  const sheet = html({ stage: "steps", step: 2, ...FILLED, rec: "new", sheet: true, code: "K7QM-4TXD-92HB-WPLE" });
  for (const text of ["Your recovery code", "K7QM-4TXD-92HB-WPLE", "Copy", "Save…", "I saved it", "Cancel", "Done"]) assert.ok(sheet.includes(text), text);
  assert.match(sheet, /role="dialog"/);
  const box = tagOf(sheet, "saved");
  assert.ok(box.includes('role="checkbox"') && box.includes('aria-checked="false"'), box);
  const saved = html({ stage: "steps", step: 2, ...FILLED, rec: true, saved: true });
  assert.match(saved, /Saved/);
  assert.match(saved, /View…/);
});

test("step 4: ConnectAI shows the ways in, the key field only for a key, and the lock when it is Not now", () => {
  assert.deepEqual(aiOptions({ space: "Northwind", adminKey: false }).map((o) => o.id), ["sub", "key"]);
  assert.deepEqual(aiOptions({ space: "Northwind", adminKey: true }).map((o) => o.id), ["sub", "key", "admin"]);
  const base = html({ stage: "steps", step: 3, ...FILLED });
  for (const text of ["Connect an AI account", "Use my subscription", "Use my own key", "Use the key from Northwind", "Not now"]) assert.ok(base.includes(text), text);
  assert.ok(tagOf(base, "ai-admin").includes('aria-checked="true"'));
  assert.ok(tagOf(base, "ai-sub").includes('aria-checked="false"'));
  assert.doesNotMatch(base, /data-testid="ai-key-field"/);
  assert.match(html({ stage: "steps", step: 3, ...FILLED, ai: "key" }), /data-testid="ai-key-field"/);
  const sub = html({ stage: "steps", step: 3, ...FILLED, ai: "sub", note: "subok" });
  assert.match(sub, /Connected as irfad@northwind\.example/);
  const none = html({ stage: "steps", step: 3, ...FILLED, ai: "none" });
  assert.match(none, /Your assistant is locked/);
  assert.doesNotMatch(none, /data-testid="ai-none"/);
  assert.match(html({ stage: "steps", step: 3, ...FILLED, error: "That username was taken a moment ago." }), /That username was taken a moment ago\./);
});

test("setup shows a progress bar and the current line; done says welcome and offers to open the Space", () => {
  const run = html({ stage: "run", step: 3, run: 2, ...FILLED });
  assert.match(run, /Setting up Northwind/);
  assert.match(run, /Syncing your projects…/);
  assert.match(run, /role="progressbar"/);
  assert.doesNotMatch(run, /Open Northwind/);
  const done = html({ stage: "done", step: 3, ...FILLED });
  assert.match(done, /You&#x27;re all set|You're all set/);
  assert.match(done, /Welcome, Dana\./);
  assert.match(done, /Open Northwind/);
  assert.match(html({ stage: "done", step: 3, ...FILLED, ai: "none" }), /Your assistant is locked until you connect an AI account\./);
});

test("an expired invite says who to ask and offers their address", () => {
  const out = html({}, { expired: true });
  for (const text of ["This invite has expired", "Ask Irfad Imtiaz for a new one.", "Email Irfad", "irfad@northwind.example"]) assert.ok(out.includes(text), text);
});

test("sign-in lists single sign-on and GitHub and no passkey; the second factor asks for six digits", () => {
  const pw = html({ stage: "signin", si: "pw" });
  for (const text of ["Sign in to Northwind", "Username", "Password", "Single sign-on", "Google", "Okta", "OpenID Connect", "GitHub"]) assert.ok(pw.includes(text), text);
  assert.doesNotMatch(pw, /passkey/i);
  assert.match(pw, /disabled/, "Continue waits for a username and password");
  const noGithub = renderToStaticMarkup(<JoinFlow invite={{ ...INVITE, github: false, sso: [] }} initial={{ stage: "signin" }} hold />);
  assert.doesNotMatch(noGithub, /Or continue with/);
  const totp = html({ stage: "signin", si: "totp", siUser: "dana", siPw: "x" });
  for (const text of ["Enter the code", "6 digit code for Northwind", "Code", "Use a recovery code", "Sign in"]) assert.ok(totp.includes(text), text);
  assert.match(totp, /maxlength="6"/i);
});

test("the checklist counts what is done, locks the assistant behind the AI account, and says All set when finished", () => {
  const items = [
    { key: "photo_and_title" as const, title: "Add a photo and title", done: true },
    { key: "connect_mailbox_and_calendar" as const, title: "Connect your mailbox and calendar", done: false },
    { key: "meet_assistant" as const, title: "Meet your assistant", done: false },
  ];
  const out = renderToStaticMarkup(<Checklist space="Northwind" items={items} visible assistantLocked heading="Good morning, Dana" dateLine="Friday, October 24" />);
  for (const text of ["Good morning, Dana", "Friday, October 24", "Get started", "1 of 4", "Connect an AI account", "Your assistant stays locked until you do", "Add a photo and title", "Done", "So agents can draft and schedule for you", "Connect an AI account first", "Locked", "Hide"]) assert.ok(out.includes(text), text);
  assert.doesNotMatch(out, /data-testid="join-panel"|data-testid="join-frame"/, "the checklist is a page of Home's layout, not a modal over a wash");
  assert.match(out, /data-testid="go-connect_mailbox_and_calendar"/);
  assert.doesNotMatch(out, /data-testid="go-meet_assistant"/, "a locked step has no action");
  assert.doesNotMatch(out, /data-testid="go-photo_and_title"/, "a done step has no action");
  const all = renderToStaticMarkup(<Checklist space="Northwind" items={items.map((i) => ({ ...i, done: true }))} visible />);
  assert.match(all, /All set/);
  assert.doesNotMatch(all, /data-testid="checklist"/);
  assert.match(renderToStaticMarkup(<Checklist space="Northwind" items={items} visible={false} />), /All set/);
});

test("the pages are flat: one column, no gradients, blurs or split panes, in light and dark", () => {
  const pages: Partial<FlowState>[] = [{}, { stage: "steps", step: 0 }, { stage: "steps", step: 1, ...FILLED }, { stage: "steps", step: 2, ...FILLED, rec: "new", sheet: true, code: "A" }, { stage: "steps", step: 3, ...FILLED }, { stage: "run", step: 3, run: 1 }, { stage: "done", step: 3 }, { stage: "signin" }];
  for (const mode of ["light", "dark"] as const) {
    for (const p of pages) {
      const out = html(p, {}, mode);
      assert.doesNotMatch(out, /gradient|blur\(|backdrop-filter/i, JSON.stringify(p));
      assert.equal(out.match(/data-testid="join-panel"/g)?.length, 1, "one panel");
      assert.equal(out.match(/data-testid="step-/g)?.length, 1, "one centred column");
    }
  }
  // the palettes are the system's own and differ by mode
  assert.notEqual(paletteOf("light").panel, paletteOf("dark").panel);
  assert.equal(paletteOf("light"), LIGHT);
  assert.equal(paletteOf("dark"), DARK);
  assert.equal(LIGHT.blue, "#007AFF");
  assert.equal(DARK.blue, "#0A84FF");
});

test("recovery codes are four groups of four from an alphabet with no look-alikes", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const code = makeRecoveryCode();
    assert.match(code, /^([A-HJKMNP-TV-Z2-9]{4}-){3}[A-HJKMNP-TV-Z2-9]{4}$/);
    seen.add(code);
  }
  assert.equal(seen.size, 50);
});
