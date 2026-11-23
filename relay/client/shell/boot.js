// @ts-check
// The shell page's script (bundle entry, iife, shell-dist/__vyre/boot.js). It takes the box key from the link's fragment, keeps it as this phone's pin, and starts the service worker
// that carries every later request to the box. An invite link carries the invite's own key instead, kept apart (pins.js). With no pin it says where to get the link; it never trusts a key the relay supplies.
import { pins, BOX_RE } from "./pins.js";

const status = /** @param {string} t */ (t) => {
  const s = document.getElementById("s");
  if (s) s.textContent = t;
};

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

/**
 * No key for this Space on this device yet (a new browser, or cleared data): the key comes only from a link the person holds, their invite or the Space link, never from the relay. So the
 * page takes the link right here: paste it and go on, instead of a line that says to go and find it. A link for another name, or one with no key in it, is said to be that.
 * No form element: the page's policy allows no form submission, and none is needed.
 */
function offerLink() {
  const m = document.getElementById("m");
  if (!m || document.getElementById("k")) return;
  const hint = document.createElement("p");
  hint.textContent = "The first time on a new device, paste your invite or Space link.";
  const field = document.createElement("input");
  field.id = "k";
  field.type = "url";
  field.autocomplete = "off";
  field.spellcheck = false;
  field.placeholder = `https://${location.host}/`;
  field.setAttribute("aria-label", "Invite or Space link");
  field.style.cssText =
    "display:block;box-sizing:border-box;width:100%;margin-top:1rem;padding:.6rem .75rem;font:inherit;border:1px solid GrayText;border-radius:.5rem;background:Field;color:FieldText";
  const use = () => {
    let u;
    try {
      u = new URL(field.value.trim());
    } catch {
      status("That is not a link. Paste the whole invite or Space link.");
      return;
    }
    if (u.host !== location.host) {
      status("That link is for a different Space.");
      return;
    }
    const h = new URLSearchParams(u.hash.slice(1));
    const invite = BOX_RE.test(h.get("k") || "") && CODE_RE.test(h.get("c") || "");
    if (!BOX_RE.test(h.get("box") || "") && !invite) {
      status("That link has no key for this Space. Ask for a new invite or the Space link.");
      return;
    }
    history.replaceState(null, "", u.pathname + u.search + u.hash);
    location.reload();
  };
  field.onkeydown = (e) => {
    if (e.key === "Enter") use();
  };
  m.append(hint, field);
  offerSwitch("Continue", use);
}

/** An invite link on a phone address: /join#c=<code>&k=<the invite's key>&fp=<fingerprint>. Everything secret is in the fragment, which never reaches a server. */
const CODE_RE = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/,
  FP_RE = /^[a-f0-9]{8,128}$/i;

async function go() {
  const info = await (await fetch("/__vyre/info.json", { cache: "no-store" })).json();
  const name = String(info.name);
  const frag = new URLSearchParams(location.hash.slice(1));
  const link = frag.get("box") || "";
  const have = await pins.get(name);
  /** @param {string} [to] where the page opens once the worker carries it (the join page keeps its fingerprint in the fragment) */
  const start = async (to) => {
    history.replaceState(null, "", to ?? location.pathname + location.search);
    if (!("serviceWorker" in navigator)) {
      status("This browser cannot open Vyre here. Try Safari or Chrome.");
      return;
    }
    status("Connecting");
    const reg = await navigator.serviceWorker.register("/__vyre/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    reg.active?.postMessage({ t: "reset" });
    // One reload takes the page over; a second one in a row means the worker is not controlling it, and looping would only hide that.
    let again = false;
    try {
      again = Date.now() - Number(sessionStorage.getItem("vyre-shell-reload") || 0) < 15_000;
      sessionStorage.setItem("vyre-shell-reload", String(Date.now()));
    } catch {
      /* storage blocked: one reload anyway */
    }
    if (again) {
      status("This browser did not let Vyre take over the page. Try again, or use Safari or Chrome.");
      offerSwitch("Try again", () => {
        try {
          sessionStorage.removeItem("vyre-shell-reload");
        } catch {
          /* storage blocked: the reload still happens */
        }
        location.reload();
      });
      return;
    }
    location.reload();
  };
  const code = frag.get("c") || "",
    invite = frag.get("k") || "",
    fp = frag.get("fp") || "";
  if (
    location.pathname.replace(/\/+$/, "") === "/join" &&
    CODE_RE.test(code) &&
    BOX_RE.test(invite) &&
    FP_RE.test(fp)
  ) {
    // a phone that already trusts this computer joins over its own channel; anyone else gets the invite's key, which opens the join page and nothing more, and only while the invite is open
    if (!have) await pins.setInvite(name, invite);
    return start(`/join/${code}#fp=${fp}`);
  }
  if (BOX_RE.test(link) && link !== have) {
    if (!have) {
      await pins.set(name, link);
      return start();
    }
    status("This link is for a different computer than the one this phone trusts.");
    offerSwitch("Use this computer", async () => {
      await pins.set(name, link);
      await start();
    });
    return;
  }
  if (!have) {
    status("Open this Space from its link");
    offerLink();
    return;
  }
  return start();
}

go().catch(() => {
  status("Could not start. Check the connection.");
  offerSwitch("Try again", () => location.reload());
});
