// @ts-check
// The shell page's script (bundle entry, iife, shell-dist/__vyre/boot.js). It takes the box key from the link's fragment, keeps it as this phone's pin, and starts the service worker
// that carries every later request to the box. With no pin it says where to get the link; it never trusts a key the relay supplies.
import { pins, BOX_RE } from "./pins.js";

const status = /** @param {string} t */ t => { const s = document.getElementById("s"); if (s) s.textContent = t; };

/** @param {string} label @param {() => void} onTap */
function offerSwitch(label, onTap) {
  const m = document.getElementById("m");
  if (!m) return;
  const b = document.createElement("button");
  b.textContent = label;
  b.style.cssText = "margin-top:1rem;padding:.6rem 1rem;font:inherit";
  b.onclick = onTap;
  m.append(b);
}

async function go() {
  const info = await (await fetch("/__vyre/info.json", { cache: "no-store" })).json();
  const name = String(info.name);
  const link = new URLSearchParams(location.hash.slice(1)).get("box") || "";
  const have = await pins.get(name);
  const start = async () => {
    history.replaceState(null, "", location.pathname + location.search);
    if (!("serviceWorker" in navigator)) { status("This browser cannot open Vyre here. Try Safari or Chrome."); return; }
    status("Connecting");
    const reg = await navigator.serviceWorker.register("/__vyre/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    reg.active?.postMessage({ t: "reset" });
    // One reload takes the page over; a second one in a row means the worker is not controlling it, and looping would only hide that.
    let again = false;
    try { again = Date.now() - Number(sessionStorage.getItem("vyre-shell-reload") || 0) < 15_000; sessionStorage.setItem("vyre-shell-reload", String(Date.now())); } catch { /* storage blocked: one reload anyway */ }
    if (again) { status("This browser did not let Vyre take over the page. Reload once, or try Safari or Chrome."); return; }
    location.reload();
  };
  if (BOX_RE.test(link) && link !== have) {
    if (!have) { await pins.set(name, link); return start(); }
    status("This link is for a different computer than the one this phone trusts.");
    offerSwitch("Use this computer", async () => { await pins.set(name, link); await start(); });
    return;
  }
  if (!have) { status("Open the link from Phone access on your computer."); return; }
  return start();
}

go().catch(() => status("Could not start. Check the connection and reload."));
