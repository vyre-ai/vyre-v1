// Owner ruling, 3 Nov 2026: Automations and the Console are not on the phone. A deep link to either on a phone draws one calm line with "Chat about it", never a blank screen or a
// broken route; the phone's You screen has no Automations row.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { PhoneHost } from "./PhoneHost.tsx";
import { CHAT_ABOUT_IT } from "../../mobile/shell/index.ts";
import { registerShellPlaces } from "../places.ts";
import { registerPlace } from "../../startup/places.ts";

// A static render draws a lazy place as its fallback, so the Chats place never shows here; a stand-in loader keeps the test from compiling the whole place in the background
// (cold, that was most of the file's time, and on a loaded runner it ran past the 30 s watchdog).
registerShellPlaces();
registerPlace("chat", async () => ({ default: () => null }));

const html = (place: "automations" | "console" | "chats", hash = ""): string =>
  renderToStaticMarkup(<PhoneHost session={null} location={{ place, hash }} needsYou={0} registerGo={() => undefined} onSignOut={() => undefined} />).replaceAll("<!-- -->", "");

test("a phone deep link to Automations or the Console shows the Chat-about-it screen", () => {
  for (const [place, hash, line] of [
    ["automations", "", "Automations open on a computer."],
    ["automations", "subject=automation%3Aaut_1", "Automations open on a computer."],
    ["console", "", "The Console opens on a computer."],
    ["console", "members", "The Console opens on a computer."],
  ] as const) {
    const out = html(place, hash);
    assert.ok(out.includes('data-testid="desktop-only"'), `${place}#${hash}`);
    assert.ok(out.includes(CHAT_ABOUT_IT) && out.includes(line), `${place}#${hash}`);
    assert.ok(out.includes('data-testid="mobile-tabs"'), "the five tabs stay, so the person is never stuck");
    assert.ok(!out.includes('data-testid="tab-automations"') && !out.includes('data-testid="tab-console"'));
  }
});

test("the phone's tabs have no Automations or Console, and a plain Chats link is unchanged", () => {
  const out = html("chats");
  for (const t of ["chats", "inbox", "records", "files", "you"]) assert.ok(out.includes(`data-testid="tab-${t}"`), t);
  assert.ok(!out.includes("desktop-only"));
  assert.ok(!/>Automations<|>Console</.test(out));
});

test("the phone's You screen offers no Automations row", () => {
  const src = readFileSync(fileURLToPath(new URL("./PhoneHost.tsx", import.meta.url)), "utf8");
  assert.ok(!src.includes('id="you-automations"') && !src.includes('entryFor("automations"'));
});
