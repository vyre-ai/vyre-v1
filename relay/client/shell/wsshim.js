// Runs in the box's own page, before the app's scripts (the service worker adds <script src="/__vyre-ws.js"> to the page's HTML and answers that request with SHIM_SOURCE, so the deploy's two
// bundles are all there is to ship). The app opens its live socket with the platform's WebSocket; here that
// goes to the service worker, which carries it over the encrypted channel. Only same-origin streams the worker allows are taken; every other WebSocket stays the browser's own.
export function installShim() {
  var sw = navigator.serviceWorker;
  if (!sw || window.__vyreWs) return;
  var Native = window.WebSocket;
  var socks = {}, next = 1;
  var post = function (m) { var c = sw.controller; if (c) c.postMessage({ vyreWs: m }); };
  var toB64 = function (buf) { var b = new Uint8Array(buf), s = ""; for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  var fromB64 = function (s) { var r = atob(s), b = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) b[i] = r.charCodeAt(i); return b.buffer; };
  var ours = function (url) {
    try {
      var u = new URL(String(url), location.href);
      var scheme = u.protocol === "wss:" ? "https:" : u.protocol === "ws:" ? "http:" : u.protocol;
      return scheme === location.protocol && u.host === location.host && (/^\/sync\/v1\/ws$/.test(u.pathname) || /^\/v1\/streams\/computers\/glass$/.test(u.pathname));
    } catch (e) { return false; }
  };
  function VyreWebSocket(url, protocols) {
    this.url = String(url); this.protocol = ""; this.extensions = ""; this.readyState = 0; this.bufferedAmount = 0; this.binaryType = "arraybuffer";
    this.onopen = this.onmessage = this.onclose = this.onerror = null; this._l = {}; this._id = next++;
    socks[this._id] = this;
    post({ t: "open", id: this._id, url: this.url, protocols: protocols });
  }
  VyreWebSocket.CONNECTING = 0; VyreWebSocket.OPEN = 1; VyreWebSocket.CLOSING = 2; VyreWebSocket.CLOSED = 3;
  VyreWebSocket.prototype.CONNECTING = 0; VyreWebSocket.prototype.OPEN = 1; VyreWebSocket.prototype.CLOSING = 2; VyreWebSocket.prototype.CLOSED = 3;
  VyreWebSocket.prototype.send = function (data) {
    if (this.readyState !== 1) throw new Error("InvalidStateError: the socket is not open");
    if (typeof data === "string") post({ t: "send", id: this._id, text: data });
    else if (data instanceof ArrayBuffer) post({ t: "send", id: this._id, b64: toB64(data) });
    else if (ArrayBuffer.isView(data)) post({ t: "send", id: this._id, b64: toB64(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) });
  };
  VyreWebSocket.prototype.close = function (code, reason) { if (this.readyState >= 2) return; this.readyState = 2; post({ t: "close", id: this._id, code: code, reason: reason }); };
  VyreWebSocket.prototype.addEventListener = function (type, fn) { (this._l[type] = this._l[type] || []).push(fn); };
  VyreWebSocket.prototype.removeEventListener = function (type, fn) { this._l[type] = (this._l[type] || []).filter(function (f) { return f !== fn; }); };
  VyreWebSocket.prototype.dispatchEvent = function (e) { this._fire(e.type, e); return true; };
  VyreWebSocket.prototype._fire = function (type, e) {
    var h = this["on" + type]; if (typeof h === "function") h.call(this, e);
    (this._l[type] || []).slice().forEach(function (f) { f.call(this, e); }, this);
  };
  window.__vyreWs = function (m) {
    var s = socks[m.id]; if (!s) return;
    if (m.t === "open") { s.readyState = 1; s._fire("open", { type: "open", target: s }); }
    else if (m.t === "message") { if (s.readyState === 1) s._fire("message", { type: "message", target: s, data: typeof m.text === "string" ? m.text : fromB64(m.b64) }); }
    else if (m.t === "error") s._fire("error", { type: "error", target: s });
    else if (m.t === "close") { delete socks[m.id]; s.readyState = 3; s._fire("close", { type: "close", target: s, code: m.code, reason: m.reason || "", wasClean: !!m.wasClean }); }
  };
  sw.addEventListener("message", function (e) { if (e.data && e.data.vyreWs) window.__vyreWs(e.data.vyreWs); });
  function Chooser(url, protocols) {
    if (sw.controller && ours(url)) return new VyreWebSocket(url, protocols);
    return protocols === undefined ? new Native(url) : new Native(url, protocols);
  }
  Chooser.CONNECTING = 0; Chooser.OPEN = 1; Chooser.CLOSING = 2; Chooser.CLOSED = 3;
  Chooser.prototype = Native.prototype;
  window.__NativeWebSocket = Native;
  window.WebSocket = Chooser;
}

/** The shim as a script the page can load: the function above, self-contained, called once. */
export const SHIM_SOURCE = `(${installShim.toString()})();`;
