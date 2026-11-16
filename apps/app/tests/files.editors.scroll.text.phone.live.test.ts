// The owner"s fault F96 (16 Nov 2026): "scroll doesnt work in edit mode". The Markdown and Word editor modes scroll with the wheel on a phone (a deck on a phone moves through its slides with the page control).
import test from "node:test";
import { editorsScroll } from "./files.editors-kit.test.ts";

test("the Markdown and Word editors scroll on a phone", async (t) => {
  await editorsScroll(t, "phone", ["md", "docx"]);
});
