// The signer's page: no account, no cookie, no storage; every address is relative to this page's own, and nothing the server sent is ever put in as HTML.
import * as pdfjs from "./pdf.js";

const app = document.getElementById("app");
const topbar = document.getElementById("top");
const REFUSAL = "This link is not valid. Ask the person who sent it for a new one.";

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat())
    if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const first = (n) =>
  String(n || "")
    .trim()
    .split(/\s+/)[0] || "";

async function post(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {}
  return { status: r.status, json, res: r };
}
const wordsOf = (json, fallback) =>
  json && json.error && typeof json.error.message === "string" ? json.error.message : fallback;

function show(...nodes) {
  app.replaceChildren(...nodes);
  const head = app.querySelector("h1");
  if (head) {
    head.setAttribute("tabindex", "-1");
    head.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
}
function sentence(text, retry) {
  topbar.hidden = true;
  document.querySelector(".skip").hidden = true;
  show(
    h(
      "div",
      { class: "center", role: "alert" },
      h(
        "div",
        null,
        h("p", { text }),
        retry
          ? h("p", null, h("button", { class: "btn", style: "margin-top:16px", onclick: retry, text: "Try again" }))
          : null,
      ),
    ),
  );
}

const dayWords = (ms, zone) => {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: zone || undefined,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toDateString();
  }
};

async function start() {
  topbar.hidden = true;
  show(h("div", { class: "center", "aria-busy": "true" }, h("p", { class: "dim", text: "Opening" })));
  let r;
  try {
    r = await post("./view", {});
  } catch {
    return sentence("The sender did not answer. Try again in a moment.", start);
  }
  if (r.status === 429) return sentence(wordsOf(r.json, "Too many tries. Wait a minute and try again."));
  if (r.status !== 200 || !r.json || !r.json.data)
    return sentence(
      r.status === 404 ? wordsOf(r.json, REFUSAL) : "The sender did not answer. Try again in a moment.",
      r.status === 404 ? undefined : start,
    );
  const v = r.json.data;
  document.title = `${v.title} - ${v.spaceName}`;
  topbar.hidden = false;
  document.getElementById("space").textContent = v.spaceName;
  document.getElementById("doctitle").textContent = v.title;
  if (v.state === "waiting") return waiting(v);
  return ready(v);
}

function waiting(v) {
  show(
    h(
      "div",
      { class: "done" },
      h("h1", { text: "Not your turn yet" }),
      h("p", {
        class: "lead",
        text: `${v.sender.name} asked you to sign ${v.title}. Someone has to sign before you. Come back to this link when they have.`,
      }),
      foot(v),
    ),
  );
}
const foot = (v) => h("p", { class: "foot", text: `Signed copies are kept by ${v.spaceName}.` });

async function ready(v) {
  const state = { name: v.signer.name || "", mode: "type", ink: false, consent: false, png: null, busy: false };
  const places = (v.places || []).filter((p) => p.kind === "signature");
  const marks = [];
  const pagesBox = h(
    "div",
    { class: "pages", role: "list", "aria-label": "The document" },
    h("div", { class: "skel", "aria-hidden": "true" }),
  );
  const textBox = h("details", { class: "readtext" }, h("summary", { text: "Read the text of this document" }));
  textBox.hidden = true;

  // ---- the signing card ----
  const nameIn = h("input", {
    type: "text",
    id: "nm",
    value: state.name,
    autocomplete: "name",
    spellcheck: "false",
    "aria-describedby": "nmhelp",
  });
  nameIn.value = state.name;
  const typedFace = h("div", { class: "typed", id: "typed", "aria-live": "polite" });
  const pad = h("canvas", {
    id: "drawpad",
    "aria-label": "Drawing area for your signature. Use Type if you cannot draw.",
    role: "img",
  });
  const padWrap = h(
    "div",
    { class: "pad", id: "padwrap", role: "tabpanel", "aria-labelledby": "tab-draw" },
    pad,
    h("div", { class: "line" }),
    h("div", { class: "hint", id: "padhint", text: "Draw your signature here" }),
  );
  const typedWrap = h(
    "div",
    { class: "pad", id: "typedwrap", role: "tabpanel", "aria-labelledby": "tab-type" },
    h("div", { class: "line" }),
    typedFace,
  );
  const clear = h("button", { class: "link", type: "button", text: "Clear", onclick: () => clearPad() });
  const typeBtn = h("button", {
    type: "button",
    role: "tab",
    id: "tab-type",
    "aria-selected": "true",
    "aria-controls": "typedwrap",
    text: "Type",
    onclick: () => setMode("type"),
  });
  const drawBtn = h("button", {
    type: "button",
    role: "tab",
    id: "tab-draw",
    "aria-selected": "false",
    "aria-controls": "padwrap",
    tabindex: "-1",
    text: "Draw",
    onclick: () => setMode("draw"),
  });
  const seg = h("div", { class: "seg", role: "tablist", "aria-label": "How to sign" }, typeBtn, drawBtn);
  seg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setMode(state.mode === "type" ? "draw" : "type");
      (state.mode === "type" ? typeBtn : drawBtn).focus();
    }
  });
  const consent = h("input", {
    type: "checkbox",
    id: "consent",
    autocomplete: "off",
    onchange: (e) => {
      state.consent = e.target.checked;
      sync();
    },
  });
  const err = h("p", { class: "err", id: "err", role: "alert", hidden: true });
  const signBtn = h("button", {
    class: "btn primary",
    type: "button",
    id: "signbtn",
    disabled: true,
    onclick: () => submit(),
    text: "Sign",
  });
  const decline = h("button", {
    class: "link",
    type: "button",
    id: "decline",
    text: "Decline to sign",
    onclick: () => declining(),
  });
  const card = h(
    "section",
    { class: "card", id: "signcard", "aria-labelledby": "sigh" },
    h("h2", { id: "sigh", text: "Your signature" }),
    h("label", { class: "f", for: "nm", text: "Your full name" }),
    nameIn,
    h("p", {
      class: "dim",
      id: "nmhelp",
      style: "margin-top:6px",
      text: "Typed as you want it to appear on the document.",
    }),
    seg,
    typedWrap,
    padWrap,
    h("div", { class: "row", style: "margin-top:6px" }, h("span", { class: "grow" }), clear),
    h("label", { class: "consent", for: "consent" }, consent, h("span", { text: v.consent })),
    err,
    h("div", { class: "row" }, signBtn, h("span", { class: "grow" }), decline),
  );

  show(
    h(
      "div",
      null,
      h("h1", { text: `${v.sender.name} asked you to sign` }),
      h("p", {
        class: "lead",
        style: "margin-top:4px",
        text: `${v.title}. This link works until ${dayWords(v.expiresAt, v.zone)}.`,
      }),
    ),
    v.message ? h("div", { class: "msg" }, h("b", { text: v.sender.name }), v.message) : null,
    pagesBox,
    textBox,
    card,
    foot(v),
  );

  // ---- the pad ----
  const ctx = pad.getContext("2d");
  let drawing = false;
  let last = null;
  const sizePad = () => {
    const r = padWrap.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const keep = state.ink ? pad.toDataURL() : null;
    pad.width = Math.round(r.width * dpr);
    pad.height = Math.round(r.height * dpr);
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#16131f";
    if (keep) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height);
      img.src = keep;
    }
  };
  const at = (e) => {
    const r = pad.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  pad.addEventListener("pointerdown", (e) => {
    drawing = true;
    last = at(e);
    pad.setPointerCapture(e.pointerId);
    ctx.beginPath();
    ctx.arc(last.x, last.y, 1.2, 0, 6.3);
    ctx.fillStyle = "#16131f";
    ctx.fill();
    state.ink = true;
    document.getElementById("padhint").hidden = true;
    sync();
    e.preventDefault();
  });
  pad.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const p = at(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
    e.preventDefault();
  });
  const stop = () => {
    drawing = false;
    updateMarks();
  };
  pad.addEventListener("pointerup", stop);
  pad.addEventListener("pointercancel", stop);
  function clearPad() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pad.width, pad.height);
    ctx.restore();
    state.ink = false;
    document.getElementById("padhint").hidden = false;
    sync();
    updateMarks();
  }
  function setMode(m) {
    state.mode = m;
    typeBtn.setAttribute("aria-selected", String(m === "type"));
    drawBtn.setAttribute("aria-selected", String(m === "draw"));
    typeBtn.tabIndex = m === "type" ? 0 : -1;
    drawBtn.tabIndex = m === "draw" ? 0 : -1;
    typedWrap.hidden = m !== "type";
    padWrap.hidden = m !== "draw";
    clear.hidden = m !== "draw";
    if (m === "draw") requestAnimationFrame(sizePad);
    sync();
    updateMarks();
  }
  nameIn.addEventListener("input", () => {
    state.name = nameIn.value;
    sync();
    updateMarks();
  });

  // The picture of the signature that goes to the server: the typed name drawn in the script face, or the drawing.
  async function signaturePng() {
    if (state.mode === "draw") return pad.toDataURL("image/png");
    try {
      await document.fonts.load('700 100px "Vyre Script"');
    } catch {}
    const c = document.createElement("canvas");
    const text = state.name.trim();
    const m = c.getContext("2d");
    const family = '"Vyre Script","Snell Roundhand","Segoe Script","Brush Script MT",cursive';
    m.font = `700 120px ${family}`;
    const w = Math.max(240, Math.min(1600, Math.ceil(m.measureText(text).width) + 80));
    c.width = w;
    c.height = 200;
    const g = c.getContext("2d");
    g.font = `700 120px ${family}`;
    g.fillStyle = "#16131f";
    g.textBaseline = "middle";
    g.textAlign = "center";
    g.fillText(text, w / 2, 100);
    return c.toDataURL("image/png");
  }
  const valid = () => state.name.trim() !== "" && state.consent && (state.mode === "type" ? true : state.ink);
  function sync() {
    typedFace.textContent = state.name.trim() || "Your name";
    typedFace.style.opacity = state.name.trim() ? "1" : ".3";
    signBtn.disabled = !valid() || state.busy;
  }
  async function updateMarks() {
    if (!marks.length) return;
    let src = null;
    if (valid() || (state.mode === "type" ? state.name.trim() : state.ink)) {
      if (state.name.trim() || state.ink) src = await signaturePng();
    }
    for (const m of marks) {
      m.el.replaceChildren();
      if (src && (state.mode === "draw" ? state.ink : state.name.trim())) {
        m.el.classList.add("done");
        m.el.append(h("img", { src, alt: "Your signature" }));
      } else {
        m.el.classList.remove("done");
        m.el.append(document.createTextNode("Sign here"));
      }
    }
  }

  async function submit() {
    if (!valid() || state.busy) return;
    state.busy = true;
    signBtn.textContent = "Signing";
    sync();
    err.hidden = true;
    let r;
    try {
      const png = (await signaturePng()).replace(/^data:image\/png;base64,/, "");
      // a typed name goes with its text and with the picture the person saw (the script face); a drawing is the picture alone
      const signature =
        state.mode === "type" ? { kind: "typed", text: state.name.trim(), png } : { kind: "drawn", png };
      r = await post("./sign", { name: state.name.trim(), consent: true, signature });
    } catch {
      r = { status: 0, json: null };
    }
    state.busy = false;
    signBtn.textContent = "Sign";
    sync();
    if (r.status === 200 && r.json && r.json.data) return done(v, state.name.trim(), r.json.data);
    if (r.status === 404) return sentence(wordsOf(r.json, REFUSAL));
    err.textContent =
      r.status === 0
        ? "The sender did not answer. Your signature was not saved. Try again."
        : wordsOf(r.json, "That did not go through. Try again.");
    err.hidden = false;
  }

  function declining() {
    const why = h("textarea", {
      id: "why",
      maxlength: "500",
      "aria-label": "Why you are declining (optional)",
      placeholder: "Reason (optional)",
    });
    const send = h("button", {
      class: "btn primary",
      type: "button",
      text: "Decline",
      onclick: async () => {
        send.disabled = true;
        let r;
        try {
          r = await post("./decline", { reason: why.value.trim() || undefined });
        } catch {
          r = { status: 0, json: null };
        }
        if (r.status === 200) return declined(v);
        if (r.status === 404) return sentence(wordsOf(r.json, REFUSAL));
        send.disabled = false;
        e2.textContent =
          r.status === 0
            ? "The sender did not answer. Try again."
            : wordsOf(r.json, "That did not go through. Try again.");
        e2.hidden = false;
      },
    });
    const e2 = h("p", { class: "err", role: "alert", hidden: true });
    const back = h("button", {
      class: "link",
      type: "button",
      text: "Go back",
      onclick: () => {
        box.replaceWith(card);
        decline.focus();
      },
    });
    const box = h(
      "section",
      { class: "card", "aria-labelledby": "dech" },
      h("h2", { id: "dech", text: "Decline to sign" }),
      h("p", { class: "lead", style: "margin-bottom:12px", text: `${v.sender.name} will be told that you declined.` }),
      why,
      e2,
      h("div", { class: "row", style: "margin-top:14px" }, send, h("span", { class: "grow" }), back),
    );
    card.replaceWith(box);
    why.focus();
  }

  // The name is whatever is in the box (autofill or a restored page put it there and the signer sees it). Consent is never taken from the control: it is a click in this view, so a tick a browser restored
  // is cleared (on load and whenever the page is shown again) and the button waits for the person's own tick.
  const readControls = (e) => {
    state.name = nameIn.value;
    // only a page the browser brought back (back, forward, a restored tab) has a tick that is not the person's; the pageshow of a first load is not one, and a tick made since is theirs
    if (e && e.persisted === true) {
      consent.checked = false;
      state.consent = false;
    }
    sync();
    updateMarks();
  };
  nameIn.addEventListener("change", () => {
    state.name = nameIn.value;
    sync();
    updateMarks();
  });
  window.addEventListener("pageshow", readControls);
  state.name = nameIn.value;
  consent.checked = false;
  state.consent = false;
  setMode("type");
  sync();

  // ---- the document ----
  let doc = null;
  try {
    // A page with no origin of its own can start a worker only from a blob, and only a classic one: the worker file is pdf.js's, with its last line (the export) taken off.
    const wsrc = await (await fetch("./assets/pdf.worker.classic.js")).text();
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(
      URL.createObjectURL(new Blob([wsrc], { type: "text/javascript" })),
    );
    const buf = await (await fetch("./doc")).arrayBuffer();
    doc = await pdfjs.getDocument({ data: buf }).promise;
  } catch {
    doc = null;
  }
  if (!doc) {
    pagesBox.replaceChildren(
      h(
        "div",
        { class: "card" },
        h("p", { text: "The document could not be shown here." }),
        h(
          "p",
          { style: "margin-top:10px" },
          h("a", { href: "./doc", target: "_blank", rel: "noopener", text: "Open the document" }),
        ),
      ),
    );
    return;
  }
  pagesBox.replaceChildren();
  const holders = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const meta = (v.pages || [])[i - 1] || { w: 612, h: 792 };
    const holder = h("div", {
      class: "page",
      role: "listitem",
      "aria-label": `Page ${i} of ${doc.numPages}`,
      style: `aspect-ratio:${meta.w}/${meta.h}`,
    });
    for (const p of v.places || []) {
      if (p.page !== i) continue;
      const el = h("button", {
        type: "button",
        class: `mark${p.kind === "date" ? " date" : ""}`,
        style: `left:${p.x}%;top:${p.y}%;width:${p.w}%;height:${p.h}%`,
        "aria-label": p.kind === "date" ? "Date, added when you sign" : "Sign here",
      });
      if (p.kind === "date") {
        el.disabled = true;
        el.textContent = "Date";
      } else {
        el.textContent = "Sign here";
        el.addEventListener("click", () => {
          card.scrollIntoView({
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            block: "center",
          });
          nameIn.focus({ preventScroll: true });
        });
        marks.push({ el });
      }
      holder.append(el);
    }
    holders.push(holder);
    pagesBox.append(holder);
  }
  void places;
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const idx = holders.indexOf(en.target);
        io.unobserve(en.target);
        void renderPage(idx + 1, en.target);
      }
    },
    { rootMargin: "800px 0px" },
  );
  holders.forEach((x) => io.observe(x));
  async function renderPage(n, holder) {
    try {
      const pg = await doc.getPage(n);
      const base = pg.getViewport({ scale: 1 });
      const css = Math.min(holder.clientWidth || 720, 760);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = pg.getViewport({ scale: (css * dpr) / base.width });
      const c = document.createElement("canvas");
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      c.setAttribute("aria-hidden", "true");
      holder.prepend(c);
      await pg.render({ canvasContext: c.getContext("2d"), viewport: vp, canvas: c }).promise;
    } catch {}
  }
  // The words of the document for a screen reader, tucked behind one disclosure.
  void (async () => {
    try {
      const out = [];
      for (let i = 1; i <= Math.min(doc.numPages, 60); i++) {
        const t = await (await doc.getPage(i)).getTextContent();
        const line = t.items
          .map((x) => x.str + (x.hasEOL ? "\n" : " "))
          .join("")
          .replace(/[ \t]+\n/g, "\n")
          .trim();
        if (line) out.push(h("h3", { class: "dim", text: `Page ${i}` }), h("pre", { text: line }));
      }
      if (out.length) {
        textBox.append(...out);
        textBox.hidden = false;
      }
    } catch {}
  })();
  updateMarks();
}

function declined(v) {
  show(
    h(
      "div",
      { class: "done" },
      h("h1", { text: "You declined to sign" }),
      h("p", { class: "lead", text: `${v.sender.name} has been told. You can close this page.` }),
      foot(v),
    ),
  );
}

function done(v, name, out) {
  const tick = h("div", { class: "tick", "aria-hidden": "true" });
  tick.textContent = "\u2713";
  const status = h("p", { class: "lead", role: "status", id: "copystate" });
  const holder = h("div", { class: "row" });
  const get = async (manual) => {
    let r;
    try {
      r = await fetch("./copy", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    } catch {
      status.textContent = "The sender did not answer. Try again in a moment.";
      return false;
    }
    if (r.status === 200 && (r.headers.get("content-type") || "").includes("pdf")) {
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      status.textContent = "Everyone has signed. Your copy is ready.";
      holder.replaceChildren(
        h("a", {
          class: "btn primary",
          id: "dl",
          href: url,
          download: `${v.title.replace(/\.pdf$/i, "")} (signed).pdf`,
          text: "Download the signed copy",
          style: "text-decoration:none;display:inline-flex;align-items:center;justify-content:center",
        }),
      );
      return true;
    }
    if (r.status === 202) {
      status.textContent = manual ? "Not everyone has signed yet." : status.textContent;
      return false;
    }
    status.textContent = "The signed copy is not available from this link. Ask the sender for it.";
    return true;
  };
  status.textContent = out.completed
    ? "Preparing your copy"
    : `${v.sender.name} will have it as soon as everyone has signed.`;
  show(
    h(
      "div",
      { class: "done" },
      tick,
      h("h1", { text: `Thank you, ${first(name)}` }),
      h("p", { class: "lead", text: `You signed ${v.title}.` }),
      status,
      holder,
      foot(v),
    ),
  );
  if (out.completed) {
    let tries = 0;
    const poll = async () => {
      if (await get(false)) return;
      if (++tries >= 20) {
        status.textContent = "Your copy is on its way. Come back to this link within a day to download it.";
        return;
      }
      setTimeout(poll, 3000);
    };
    void poll();
  } else {
    holder.append(
      h("button", { class: "btn", type: "button", text: "Check for the signed copy", onclick: () => void get(true) }),
    );
  }
}

void start();
