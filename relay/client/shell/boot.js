// @ts-check
// The shell page's script (bundle entry, iife, shell-dist/__vyre/boot.js). It takes the box key from the link's fragment, keeps it as this phone's pin, and starts the service worker
// that carries every later request to the box. An invite link carries the invite's own key instead, kept apart (pins.js). With no pin it says where to get the link; it never trusts a key the relay supplies.
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

/** An invite link on a phone address: /join#c=<code>&k=<the invite's key>&fp=<fingerprint>. Everything secret is in the fragment, which never reaches a server. */
const CODE_RE = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/, FP_RE = /^[a-f0-9]{8,128}$/i;

async function go() {
  const info = await (await fetch("/__vyre/info.json", { cache: "no-store" })).json();
  const name = String(info.name);
  const frag = new URLSearchParams(location.hash.slice(1));
  const link = frag.get("box") || "";
  const have = await pins.get(name);
  /** @param {string} [to] where the page opens once the worker carries it (the join page keeps its fingerprint in the fragment) */
  const start = async (to) => {
    history.replaceState(null, "", to ?? location.pathname + location.search);
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
  const code = frag.get("c") || "", invite = frag.get("k") || "", fp = frag.get("fp") || "";
  if (location.pathname.replace(/\/+$/, "") === "/join" && CODE_RE.test(code) && BOX_RE.test(invite) && FP_RE.test(fp)) {
    // a phone that already trusts this computer joins over its own channel; anyone else gets the invite's key, which opens the join page and nothing more, and only while the invite is open
    if (!have) await pins.setInvite(name, invite);
    return start(`/join/${code}#fp=${fp}`);
  }
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
