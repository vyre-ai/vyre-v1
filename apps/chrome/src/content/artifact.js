// @ts-check
// A click on a link to a Vyre artifact (https://<space>/a/<id>) in a Space the person is signed in to here is handed to the extension, which opens it as that person (bridge op artifact.open: the Space
// mints a single-use code and the artifact opens in a tab). Nothing is read from the page and no cookie is touched. Only a real click on a real link counts; on the Space's own pages the link is left to the
// web app; and when the extension cannot open it (signed out, not shared with the person, incognito, no app) the link goes where it was going.
(function () {
  /** @type {any} */
  const g = globalThis;
  const ART = /^\/a\/sit_[a-z0-9]+\/?$/;
  /** @type {Set<string>} */
  let hosts = new Set();
  const load = () => { try { g.chrome.runtime.sendMessage({ type: "vyre.artifact.hosts" }, (/** @type {any} */ r) => { if (r && r.data && Array.isArray(r.data.hosts)) hosts = new Set(r.data.hosts.map(String)); }); } catch { /* reloaded */ } };
  load();
  g.addEventListener("focus", load);

  g.document.addEventListener("click", (/** @type {any} */ e) => {
    if (!e.isTrusted || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    const a = path.find((/** @type {any} */ n) => n && n.tagName === "A" && n.href);
    if (!a) return;
    let u;
    try { u = new URL(a.href); } catch { return; }
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !hosts.has(u.host) || !ART.test(u.pathname) || u.host === g.location.host) return;
    e.preventDefault();
    e.stopPropagation();
    const go = () => { if (a.target === "_blank") g.open(a.href, "_blank", "noopener"); else g.location.assign(a.href); };
    try {
      g.chrome.runtime.sendMessage({ type: "vyre.artifact", href: a.href }, (/** @type {any} */ r) => { if (!(r && r.data && r.data.handled)) go(); });
    } catch { go(); }
  }, true);
})();
