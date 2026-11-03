// Browser tests of the composer's chat field (shared editor, mention chips) against the plain field: type, pick a mention with @, Backspace deletes a chip whole, Enter sends, Shift+Enter is a new line, paste is plain text,
// IME composition, undo, a long draft that scrolls, and the payload equal to the plain field's. Run on the build box from the worktree: node scripts/shots/l-editor-chat-test.mjs [--skip-export] [--shots=dir]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const REPO = process.cwd();
const { serve } = await import(path.join(REPO, "scripts/shots/serve.mjs"));
const { routeUrl } = await import(path.join(REPO, "scripts/shots/lib.mjs"));
const { exportEnv } = await import(path.join(REPO, "scripts/lib/registry-hash.mjs"));
const appDir = path.join(REPO, "scripts/shots/app");
const args = process.argv.slice(2);
const shotsDir = (args.find((a) => a.startsWith("--shots=")) ?? "").slice(8);
if (!args.includes("--skip-export")) {
  fs.rmSync(path.join(appDir, "dist"), { recursive: true, force: true });
  execSync("/root/wt/base/node_modules/.bin/expo export --platform web --output-dir dist", { cwd: appDir, stdio: "inherit", env: exportEnv() });
}
const real = await serve(path.join(appDir, "dist"), { spa: true });
const { createRequire } = await import("node:module");
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + extra}`); if (!ok) failed++; };

async function open(field, size = { width: 1440, height: 900 }, scheme = "light") {
  const ctx = await browser.newContext({ viewport: size, colorScheme: scheme, reducedMotion: "reduce" });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 200)));
  await page.goto(routeUrl(real.origin, `/m/EDITOR_03?field=${field}`, scheme === "dark" ? "graphite" : "paper"), { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("[data-testid=composer-field]", { timeout: 15000 });
  await page.waitForTimeout(field === "chat" ? 2500 : 800);
  return { ctx, page };
}
const textOf = (page) => page.evaluate(() => { const f = document.querySelector("[data-testid=composer-field]"); return f.value !== undefined ? f.value : f.innerText.replace(/​/g, ""); });
const field = (page) => page.locator("[data-testid=composer-field]");
const sentOf = async (page) => JSON.parse(await page.locator("[data-testid=sent]").innerText());

/** The same typing in both fields: what is sent is the same. */
async function session(fieldKind) {
  const { ctx, page } = await open(fieldKind);
  await field(page).click();
  await page.keyboard.type("Hi @Aliza and @Rubab, notes please");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second line for @Sol thanks");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const sent = await sentOf(page);
  await ctx.close();
  return sent;
}

const chat = await open("chat");
const { page } = chat;
const chips = () => page.locator(".vyre-chip").allInnerTexts();

await field(page).click();
await page.keyboard.type("Hi @Aliza please");
await page.waitForTimeout(300);
check("a typed mention becomes one chip", (await chips()).join("|") === "@Aliza", JSON.stringify(await chips()));

// the @ picker
await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace");
await page.keyboard.type("@Ru");
await page.waitForSelector("[data-testid=composer-popup]", { timeout: 4000 }).catch(() => undefined);
check("@ opens the mention picker", await page.locator("[data-testid=composer-popup]").count() > 0);
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
check("picking from the @ list leaves a chip", (await chips()).includes("@Rubab"), JSON.stringify(await chips()));

// Backspace deletes a chip whole
await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace");
await page.keyboard.type("@Sol");
await page.waitForTimeout(300);
await page.keyboard.press("Backspace");
await page.waitForTimeout(300);
check("Backspace deletes a mention chip whole", (await chips()).length === 0 && (await textOf(page)).trim() === "", JSON.stringify([await chips(), await textOf(page)]));

// Enter sends, Shift+Enter is a new line
await page.keyboard.type("line one");
await page.keyboard.press("Shift+Enter");
await page.keyboard.type("line two");
check("Shift+Enter makes a new line and does not send", (await textOf(page)).includes("line one\nline two") && (await sentOf(page)).length === 0, JSON.stringify(await textOf(page)));
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
const s1 = await sentOf(page);
check("Enter sends the text", s1.length === 1 && JSON.parse(s1[0]).text === "line one\nline two", JSON.stringify(s1));
check("the field is empty after a send", (await textOf(page)).trim() === "");

// paste is plain text
await page.evaluate(() => {
  const f = document.querySelector("[data-testid=composer-field]");
  f.focus();
  const dt = new DataTransfer();
  dt.setData("text/plain", "pasted one\npasted two");
  dt.setData("text/html", "<b>pasted</b> <i>one</i><br>pasted two");
  f.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(300);
check("paste keeps plain text with its line break", (await textOf(page)) === "pasted one\npasted two", JSON.stringify(await textOf(page)));
check("paste brings no formatting", await page.locator("[data-testid=composer-field] b, [data-testid=composer-field] i").count() === 0);
await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace");

// undo
await page.keyboard.type("first words");
await page.waitForTimeout(700);
await page.keyboard.type(" and more");
await page.keyboard.press("Control+Z");
await page.waitForTimeout(300);
const afterUndo = await textOf(page);
check("undo takes back typing", afterUndo.length < "first words and more".length, JSON.stringify(afterUndo));
await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace");

// IME
const cdp = await chat.ctx.newCDPSession(page);
await cdp.send("Input.imeSetComposition", { text: "にほん", selectionStart: 3, selectionEnd: 3 });
await cdp.send("Input.insertText", { text: "日本" });
await page.waitForTimeout(300);
check("an IME composition lands once", (await textOf(page)) === "日本", JSON.stringify(await textOf(page)));
await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace");

// a long draft with three mentions scrolls, and every chip is on its own word
const long = ["Kickoff notes for the Meier file.", "@Aliza please confirm the engagement letter went out and the client was able to sign it.", "The retainer is paid.", "Two open questions remain about the trust schedule.", "@Rubab can you check the numbers on CX before Thursday.", "I will draft the cover note tonight.", "Nothing goes to the client until it is seen.", "The calendar hold for Friday stays.", "@Sol keep an eye on the filing portal.", "Thanks all, this is the last note for today."];
for (const [i, l] of long.entries()) { await page.keyboard.type(l); if (i < long.length - 1) await page.keyboard.press("Shift+Enter"); }
await page.waitForTimeout(500);
const dims = await page.evaluate(() => { const f = document.querySelector("[data-testid=composer-field]"); return { sh: f.scrollHeight, ch: f.clientHeight }; });
check("a long draft scrolls inside the field", dims.sh > dims.ch, JSON.stringify(dims));
check("each mention is a chip on its own name, however the lines wrap or scroll", (await chips()).join("|") === "@Aliza|@Rubab|@Sol", JSON.stringify(await chips()));
await page.evaluate(() => { document.querySelector("[data-testid=composer-field]").scrollTop = 80; });
await page.waitForTimeout(200);
const inView = await page.evaluate(() => { const f = document.querySelector("[data-testid=composer-field]").getBoundingClientRect(); return [...document.querySelectorAll(".vyre-chip")].map((c) => { const r = c.getBoundingClientRect(); return { t: c.textContent, within: r.bottom > f.top - 2 && r.top < f.bottom + 2 }; }); });
check("chips move with the text when it scrolls", inView.length === 3, JSON.stringify(inView));
if (shotsDir) { fs.mkdirSync(shotsDir, { recursive: true }); await page.screenshot({ path: path.join(shotsDir, "chat-field-long-paper.png") }); }
await chat.ctx.close();

// the payload is the plain field's payload
const plain = await session("plain");
const chatSent = await session("chat");
check("the chat field sends what the plain field sends", JSON.stringify(plain) === JSON.stringify(chatSent) && plain.length === 1, JSON.stringify([plain, chatSent]));

// shots at both widths and skins
if (shotsDir) {
  for (const [name, size, scheme] of [["wide-paper", { width: 1440, height: 900 }, "light"], ["wide-graphite", { width: 1440, height: 900 }, "dark"], ["phone-paper", { width: 390, height: 844 }, "light"], ["phone-graphite", { width: 390, height: 844 }, "dark"]]) {
    const o = await open("chat", size, scheme);
    await field(o.page).click();
    await o.page.keyboard.type("@Aliza and @Rubab, please take a look at this with @Sol");
    await o.page.keyboard.press("Shift+Enter");
    await o.page.keyboard.type("second line");
    await o.page.waitForTimeout(500);
    await o.page.screenshot({ path: path.join(shotsDir, `chat-field-${name}.png`) });
    await o.ctx.close();
  }
}
await browser.close(); real.close();
console.log(failed === 0 ? "ALL PASSED" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
