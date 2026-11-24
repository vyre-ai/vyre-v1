// The Space's own "Connect Vyre for Chrome" page (/chrome/connect) hands the one-time pair code to the extension through this script. It acts on that one path only, listens to
// its own window only, and the worker accepts the code only from the origin of the Space the person typed in the panel.
(() => {
  if (location.pathname !== "/chrome/connect") return;
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.type !== "vyre.chrome.code" || typeof d.code !== "string" || d.code.length > 64) return;
    chrome.runtime.sendMessage({ type: "vyre.link.code", code: d.code }).then(
      (r) =>
        window.postMessage({ type: "vyre.chrome.linked", ok: Boolean(r && r.data && r.data.linked) }, location.origin),
      () => window.postMessage({ type: "vyre.chrome.linked", ok: false }, location.origin),
    );
  });
})();
