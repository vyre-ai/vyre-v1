// Theme and CSS (spec 2.11): the Space's skin, the form's own theme on top, and the author's custom CSS filtered before it is written into a public page.
import test from "node:test";
import assert from "node:assert/strict";
import { mix, readableOn, sanitizeCss, skinFor, styleSheet, tokens } from "../src/theme.js";
import { define } from "./fixtures.ts";

test("skins: Northwind's Paper and Harbor Studio's Dusk give the form their palettes; an unknown skin is Paper", () => {
  assert.equal(skinFor("dusk"), "dusk");
  assert.equal(skinFor("paper"), "paper");
  assert.equal(skinFor("graphite"), "paper");
  assert.equal(skinFor(undefined), "paper");
  const paper = tokens(define({ theme: { skin: "paper" } }));
  assert.match(paper, /--win:#ffffff;/);
  assert.match(paper, /--ink:#18181a;/);
  assert.match(paper, /--accent:#5b5bd6;--accent-ink:#ffffff;/);
  const dusk = tokens(define({ theme: { skin: "dusk" } }));
  assert.match(dusk, /--win:#17151c;/);
  assert.match(dusk, /--ink:#ece8f2;/);
  assert.match(dusk, /--accent:#b49cff;--accent-ink:#18181a;/, "text on a light accent is dark");
  assert.match(dusk, /--danger:#ff8a80/);
  assert.match(paper, /--danger:#c62828/);
});

test("the form's own theme wins over the skin: colours, radius, width and one of four font stacks", () => {
  const t = tokens(define({ theme: { skin: "paper", background: "#fff8e1", ink: "#202020", accent: "#c62828", radius: 12, width: 640, font: "serif" } }));
  assert.match(t, /--win:#fff8e1;/);
  assert.match(t, /--ink:#202020;/);
  assert.match(t, /--accent:#c62828;/);
  assert.match(t, /--radius:12px;--width:640px;--font:ui-serif/);
  const d = tokens(define({ theme: {} }));
  assert.match(d, /--radius:8px;--width:560px;--font:system-ui/);
});

test("colour helpers: mix blends by share, readableOn picks dark or light text", () => {
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mix("#102030", "#102030", 0.7), "#102030");
  assert.equal(mix("#000000", "#ffffff", 0), "#000000");
  assert.equal(readableOn("#ffffff"), "#18181a");
  assert.equal(readableOn("#000000"), "#ffffff");
  assert.equal(readableOn("#5b5bd6"), "#ffffff");
});

test("custom CSS: ordinary rules pass untouched, comments go, media and font-face blocks stay, other at-rules go", () => {
  assert.equal(sanitizeCss(".a{color:red}/* hidden */.b{color:blue}"), ".a{color:red}.b{color:blue}");
  assert.equal(sanitizeCss("@media (max-width:480px){.a{color:red}}"), "@media (max-width:480px){.a{color:red}}");
  assert.equal(sanitizeCss("@font-face{font-family:X;src:url(https://fonts.example/x.woff2)}"), "@font-face{font-family:X;src:url(https://fonts.example/x.woff2)}");
  assert.equal(sanitizeCss("@keyframes spin{from{a:b}to{a:c}} .a{color:red}"), ".a{color:red}");
  assert.equal(sanitizeCss('@charset "x"; .a{color:red}'), ".a{color:red}");
  assert.equal(sanitizeCss(""), "");
});

test("custom CSS: nothing that loads or runs code gets through, however it is spelled", () => {
  assert.equal(sanitizeCss("@import url(https://evil.example/x.css); .a{color:red}"), ".a{color:red}");
  assert.equal(sanitizeCss("a{width:expression(alert(1))} .ok{color:red}"), ".ok{color:red}");
  assert.equal(sanitizeCss("a{behavior:url(x.htc)} .ok{color:red}"), ".ok{color:red}");
  assert.equal(sanitizeCss("a{-moz-binding:url(x)} .ok{color:red}"), ".ok{color:red}");
  assert.equal(sanitizeCss("a{background:url(javascript:alert(1))} .ok{color:red}"), ".ok{color:red}");
  assert.equal(sanitizeCss("a{x:\\6a avascript\\3a alert(1)} .ok{color:red}"), ".ok{color:red}", "an escaped keyword is still the keyword");
  assert.equal(sanitizeCss("@\\69mport url(https://evil.example/x.css); .ok{color:red}"), ".ok{color:red}");
  assert.equal(sanitizeCss("</style><script>alert(1)</script>"), "");
  assert.equal(sanitizeCss("a{content:'</style><script>x</script>'}"), "");
  assert.ok(!sanitizeCss("a::before{content:'<b>'}").includes("<"), "an angle bracket is written as a CSS escape");
});

test("custom CSS: url() reaches only https addresses and paths on this site", () => {
  assert.equal(sanitizeCss("a{background:url('https://ok.example/x.png')}"), "a{background:url('https://ok.example/x.png')}");
  assert.equal(sanitizeCss("a{background:url(/img/bg.png)}"), "a{background:url(/img/bg.png)}");
  assert.equal(sanitizeCss("a{background:url(http://evil.example/x.png)}"), "a{background:none}");
  assert.equal(sanitizeCss("a{background:url(//evil.example/x.png)}"), "a{background:none}");
  assert.equal(sanitizeCss("a{background:url(data:image/svg+xml;base64,AAAA)}"), "a{background:none}");
  assert.equal(sanitizeCss("a{background:url(\\\\evil.example\\x)}"), "a{background:none}");
});

test("the stylesheet is the tokens, the base rules and the filtered CSS, in that order, and a hostile author's CSS cannot change the first two", () => {
  const css = styleSheet(define({ css: "@import url(https://evil.example/x.css);.vf-title{letter-spacing:.02em}", theme: { skin: "dusk" } }));
  assert.ok(css.startsWith(":root{--win:#17151c;"));
  assert.ok(css.includes(".vf-wrap{max-width:var(--width)"));
  assert.ok(css.endsWith(".vf-title{letter-spacing:.02em}"));
  assert.ok(!css.includes("@import") && !css.includes("evil.example"));
  assert.ok(css.includes("@media (prefers-reduced-motion:reduce)"), "motion is off for people who asked");
  assert.ok(css.includes(":focus-visible{outline:2px solid var(--accent)"), "keyboard focus is always visible");
});
