// The profile header and About: one header for a person and for an agent (face with presence, one role line that opens on press, Message and only what the shell can do, one "..." menu),
// tabs shown only when useful, and an agent without a computer getting one quiet row in About, never a button that cannot work.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatRightPane } from "./ChatRightPane.tsx";
import { ProfileHeader, roleLine } from "./ProfileHeader.tsx";
import { createSample } from "./sample.ts";
import { tabsOf } from "./model.ts";
import { RunsOn } from "./ComputerTab.tsx";

const ALL = { start: 0, end: 500 };
const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const has = (s: string, n: string): boolean => s.includes(n);

test("the role line is the kind, then the role with its first letter lowered", () => {
  assert.equal(roleLine("Agent", "Runs the nightly builds"), "Agent · runs the nightly builds");
  assert.equal(roleLine("Agent", undefined), "Agent");
});

test("the header draws Message and only the actions it is given, a presence dot, and one menu", () => {
  const out = clean(renderToStaticMarkup(<ProfileHeader name="Dex" kind="agent" presence="asleep" line="Agent · runs the builds" actions={[{ key: "message", icon: "chat", label: "Message", onPress: () => undefined }]} onMore={() => undefined} />));
  assert.ok(has(out, 'data-testid="profile-message"') && !has(out, 'data-testid="profile-poke"') && !has(out, 'data-testid="profile-share"'), "no button for what cannot be done");
  assert.ok(has(out, 'aria-label="Asleep"'), "the presence dot says its word");
  assert.equal(out.split('data-testid="pane-more"').length - 1, 1, "one menu");
  assert.ok(has(out, 'aria-expanded="false"'), "the role line is closed until pressed");
});

test("the pane for an agent with a computer: About first, Computer, Chats, Files, Terminal; Poke and Share only where the shell has them", () => {
  const s = createSample();
  assert.deepEqual(tabsOf(true).map((t) => t.title), ["About", "Computer", "Chats", "Files", "Terminal", "Knows", "Routines"]);
  const bare = clean(renderToStaticMarkup(<ChatRightPane data={s.data} open onToggle={() => undefined} window={ALL} />));
  assert.ok(has(bare, 'data-testid="about-tab"') && has(bare, 'data-testid="profile-message"'));
  assert.ok(!has(bare, 'data-testid="profile-poke"') && !has(bare, 'data-testid="profile-share"'));
  const withNav = { ...s.data, nav: { ...s.data.nav, poke: () => undefined, share: () => undefined } };
  const full = clean(renderToStaticMarkup(<ChatRightPane data={withNav} open onToggle={() => undefined} window={ALL} />));
  assert.ok(has(full, 'data-testid="profile-poke"') && has(full, 'data-testid="profile-share"'));
});

test("an agent with no terminal or browser bound here: no Computer tab, and About says so in one row that offers nothing to set up", () => {
  const s = createSample();
  const data = { ...s.data, agent: { agentId: "agt_intake", name: "Intake" } };
  const out = clean(renderToStaticMarkup(<ChatRightPane data={data} open onToggle={() => undefined} window={ALL} />));
  assert.ok(!has(out, ">Computer<") && !has(out, ">Terminal<"), "no Computer or Terminal tab");
  assert.ok(has(out, 'data-testid="about-no-computer"') && has(out, "No terminal or browser here yet") && has(out, "Intake works through tools") && !has(out, "Give Intake a computer") && !has(out, 'data-testid="about-give"'));
  const none = clean(renderToStaticMarkup(<ChatRightPane data={{ ...data, space: { ...data.space, computers: false } }} open onToggle={() => undefined} window={ALL} />));
  assert.ok(has(none, 'data-testid="about-no-computer"') && !has(none, 'data-testid="about-give"'), "no offer where no computer can run one");
});

test("About reads from the Space: what it is responsible for, and the shared folder", () => {
  const out = clean(renderToStaticMarkup(<ChatRightPane data={createSample().data} open onToggle={() => undefined} tab="about" window={ALL} />));
  assert.ok(has(out, "Responsible for") && has(out, "Books first calls and follows up on cold inquiries"));
  assert.ok(has(out, "Intake's folder") && has(out, "Shared with Vyre Files"));
  assert.ok(!/\b(he|she|her|his|hers)\b/i.test(out.replace(/<[^>]+>/g, " ")), "the pane never guesses pronouns");
});

test("no computer: the quiet row is the first thing in About, above Responsible for, and it has no button", () => {
  const s = createSample();
  const out = clean(renderToStaticMarkup(<ChatRightPane data={{ ...s.data, agent: { agentId: "agt_intake", name: "Intake" } }} open onToggle={() => undefined} window={ALL} />));
  assert.ok(out.indexOf('data-testid="about-no-computer"') > 0 && out.indexOf('data-testid="about-no-computer"') < out.indexOf("Responsible for"));
  assert.ok(!has(out, 'data-testid="about-give"'), "nothing to press");
});

test("Runs on opens Console, Computers with that machine selected; without a shell that can, it is a plain line", () => {
  const seen: (string | undefined)[] = [];
  const line = RunsOn({ text: "On the Space server · 2 of 8 tabs", onPress: () => seen.push("space") }) as unknown as { props: { onPress?: () => void } };
  line.props.onPress?.();
  assert.deepEqual(seen, ["space"]);
  const plain = RunsOn({ text: "On the Space server · 2 of 8 tabs" }) as unknown as { props: { onPress?: () => void } };
  assert.equal(plain.props.onPress, undefined);
});
