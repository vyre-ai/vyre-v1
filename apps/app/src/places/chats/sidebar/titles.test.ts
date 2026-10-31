// What an untitled chat is called: who and the day, this device's first line when it has one, and any title given on purpose first.
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultTitle, displayTitle, firstLine, rememberFirstLine } from "./titles.ts";

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
const OCT31 = Date.UTC(2026, 9, 31, 12);

test("the default title is who and the day, in the person's own offset", () => {
  assert.equal(defaultTitle("Mailer", OCT31, 0), "Mailer · Oct 31");
  assert.equal(defaultTitle("Mailer", Date.UTC(2026, 9, 31, 23), 300), "Mailer · Nov 1");
});

test("a first line drops mentions and markup, is cut at a word, and is null when nothing is readable", () => {
  assert.equal(firstLine("@Mailer **draft** the welcome email.\nthen send it"), "draft the welcome email");
  assert.equal(firstLine("x".repeat(30) + " " + "y".repeat(40)), `${"x".repeat(30)}…`);
  assert.equal(firstLine("@Mailer"), null);
});

test("an untitled chat shows this device's first line, else who and the day; a given title always wins", () => {
  const row = { threadId: "thr_1", title: "New chat", who: "Mailer", lastAt: OCT31 };
  assert.equal(displayTitle(row, 0), "Mailer · Oct 31");
  rememberFirstLine("thr_1", "Draft the welcome email for the new clients");
  assert.equal(displayTitle(row, 0), "Draft the welcome email for the new clients");
  rememberFirstLine("thr_1", "A later message does not rename it");
  assert.equal(displayTitle(row, 0), "Draft the welcome email for the new clients");
  assert.equal(displayTitle({ ...row, title: "Onboarding" }, 0), "Onboarding");
});
