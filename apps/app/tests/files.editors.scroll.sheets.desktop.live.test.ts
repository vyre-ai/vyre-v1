// The owner"s fault F96 (16 Nov 2026): "scroll doesnt work in edit mode". The workbook and a 30 slide deck editor modes scroll with the wheel on a desktop (a deck on a phone moves through its slides with the page control).
import test from "node:test";
import { editorsScroll } from "./files.editors-kit.test.ts";

test("the workbook and a 30 slide deck editors scroll on a desktop", async (t) => {
  await editorsScroll(t, "desktop", ["xlsx", "pptx"]);
});
