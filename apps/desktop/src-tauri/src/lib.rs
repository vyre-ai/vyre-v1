// Tauri 2 shell for Vyre. The system webview (WKWebView on Mac, WebView2 on Windows) loads the Expo web
// build, which keeps its encrypted replica in OPFS exactly as on the web. Around it the shell does four things:
//   1. runs the vyred device daemon as a sidecar and tells the page where it listens (sidecar.rs),
//   2. registers the vyre:// scheme and passes links to the page (links.rs, commands.rs),
//   3. registers the global shortcut CommandOrControl+Shift+V to bring the window forward,
//   4. keeps one instance: a second launch (or a link on Windows and Linux) focuses the first,
//   5. native features for the page: tray icon, OS notifications whose click opens the thread, file and folder dialog, Needs you badge (native.rs),
//   6. updates itself: a check at launch, and on the page's word the signed update installs once nothing runs here (updater.rs).
// No keychain: the replica key is wrapped in IndexedDB by the page, so an ad-hoc signed Mac app works (ARCH 5.10).

mod chrome;
mod commands;
mod links;
mod native;
mod sidecar;
mod updater;
mod winsandbox;
mod personal;
mod macserver;

use commands::AppState;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const SHORTCUT: &str = "CommandOrControl+Shift+V";

/// Run in the page after every load: report script errors and how much text rendered, through our own command.
/// This is how a blank window shows up in the log (and in the desktop job) instead of staying a mystery.
const PAGE_PROBE: &str = r#"(function () {
  var inv = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  if (!inv || window.__vyreProbe) return;
  window.__vyreProbe = true;
  function send(kind, text) { try { inv("page_report", { kind: kind, text: String(text) }); } catch (e) {} }
  window.addEventListener("error", function (e) { send("error", e.message); });
  window.addEventListener("unhandledrejection", function (e) { send("error", e.reason); });
  setTimeout(function () {
    var n = document.body ? document.body.innerText.length : 0;
    send("rendered", n + " chars at " + location.protocol + "//" + location.host + location.pathname);
  }, 2000);
})();"#;

/// Run in the page after every load: a link that leaves the app (window.open, or an anchor to another site) opens in the default browser through open_link.
/// The webview opens no windows of its own, so without this a button like "Open the sign-in" does nothing.
const EXTERNAL_LINKS: &str = r#"(function () {
  var inv = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  if (!inv || window.__vyreLinks) return;
  window.__vyreLinks = true;
  function outside(raw) {
    try { var u = new URL(String(raw), location.href); return (u.protocol === "https:" || u.protocol === "http:") && u.origin !== location.origin ? u.href : null; } catch (e) { return null; }
  }
  var own = window.open;
  window.open = function (url) {
    var href = outside(url);
    if (href) { inv("open_link", { url: href }).catch(function (e) { inv("page_report", { kind: "link", text: String(e) }); }); return null; }
    return own ? own.apply(window, arguments) : null;
  };
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    var href = a ? outside(a.getAttribute("href")) : null;
    if (!href || e.defaultPrevented) return;
    e.preventDefault();
    inv("open_link", { url: href });
  }, true);
})();"#;

/// Run in the page after every load: the desktop app has no service worker (the page never registers one, startup/boot.ts). One an earlier version registered is removed with its caches, and
/// the page loads again. On Windows such a worker took over every page load from the second start and the window drew nothing (update-proof run 41627777786), so the page itself could not run
/// the code that fixes it: the shell does it from here, whatever page the worker served.
pub(crate) const NO_SERVICE_WORKER: &str = r#"(function () {
  if (window.__vyreNoSw || !navigator.serviceWorker || !navigator.serviceWorker.getRegistrations) return;
  window.__vyreNoSw = true;
  var inv = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  navigator.serviceWorker.getRegistrations().then(function (rs) {
    if (!rs.length) return;
    var gone = Promise.all(rs.map(function (r) { return r.unregister(); }));
    var cleared = window.caches ? caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }) : Promise.resolve();
    Promise.all([gone, cleared]).then(function () {
      if (inv) inv("page_report", { kind: "service-worker", text: "removed " + rs.length + " service worker(s) an earlier version registered; loading again" }).catch(function () {});
      location.replace("/");
    }, function () {});
  }, function () {});
})();"#;

/// Two animation frames after the page starts drawing, tell the shell. rAF stops in a window that cannot be seen, so the timer keeps this from depending on it.
const FIRST_FRAME: &str = r#"(function () {
  var sent = false;
  function go() {
    if (sent) return;
    sent = true;
    var core = window.__TAURI__ && window.__TAURI__.core;
    if (core) core.invoke("first_frame").catch(function () {});
  }
  requestAnimationFrame(function () { requestAnimationFrame(go); });
  setTimeout(go, 400);
})();"#;

/// A webview in a hidden window draws nothing, so a window shown when the page finishes loading can open on an empty white frame. On a Mac the window goes on screen almost
/// transparent, which lets the page draw, and comes up once a frame of the page is really there (FIRST_FRAME). It is never left that way: see the thread in setup.
#[cfg(target_os = "macos")]
fn set_window_alpha(window: &tauri::WebviewWindow, alpha: f64) {
    if let Ok(ns_window) = window.ns_window() {
        let ns_window = ns_window as *mut objc2::runtime::AnyObject;
        // SAFETY: ns_window is the live NSWindow of this window, and every caller is on the main thread.
        unsafe {
            let _: () = objc2::msg_send![ns_window, setAlphaValue: alpha];
        }
    }
}

/// Almost, not quite, 0: a fully transparent window counts as occluded, and WebKit does not draw for it.
#[cfg(target_os = "macos")]
const WAITING_ALPHA: f64 = 0.01;

/// The window at full strength. Idempotent, and harmless where the window was never transparent.
fn raise_main(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    if let Some(w) = app.get_webview_window("main") {
        let on_main = w.clone();
        let _ = app.run_on_main_thread(move || set_window_alpha(&on_main, 1.0));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// The page has drawn: the window can come up.
#[tauri::command]
fn first_frame(app: AppHandle) {
    raise_main(&app);
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// The shortcut toggles: forward when hidden or behind, hidden when it is already the front window.
fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let front = w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false);
        if front {
            let _ = w.hide();
        } else {
            show_main(app);
        }
    }
}

/// CI only (VYRE_SHELL_BANNER=1): a corner label with what the shell knows, so a screenshot of the running window shows the sidecar connected.
const BANNER: &str = r#"(function () {
  var inv = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  if (!inv || window.__vyreBanner) return;
  window.__vyreBanner = true;
  var box = document.createElement("div");
  box.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483647;padding:10px 14px;border-radius:10px;background:#161616;color:#f4f1ea;font:14px/1.4 -apple-system,Segoe UI,sans-serif;white-space:pre";
  box.textContent = "Vyre desktop shell\nsidecar: starting";
  // The page hydrates after load and can replace what we added, so keep the label attached.
  function attach() { if (document.body && !box.isConnected) document.body.appendChild(box); }
  attach();
  setInterval(attach, 300);
  function tick() {
    inv("desktop_info").then(function (i) {
      var s = i.sidecar;
      box.textContent = "Vyre desktop shell " + i.version + " (" + i.platform + " " + i.arch + ")\nsidecar: " + s.phase + (s.url ? " at " + s.url : "") + (s.version ? ", vyred " + s.version : "");
      if (s.phase !== "ready") setTimeout(tick, 400);
    }, function () { setTimeout(tick, 800); });
  }
  tick();
})();"#;

/// CI only (VYRE_SHELL_PROOF_URL=http://127.0.0.1:<port>): drives the shell's commands from the page, over the real IPC, the way the Settings screens do, and posts what came back to the loopback
/// collector the desktop job runs: ensure_personal_space, then discover_session_sources and read_session_source for each session found. The collector is the only address it talks to.
const PROOF: &str = r#"(function () {
  var inv = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  if (!inv || window.__vyreProof) return;
  window.__vyreProof = true;
  var url = "__PROOF_URL__";
  function post(body) { return fetch(url + "/proof", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(body) }); }
  (async function () {
    var out = { personal: null, sources: null, reads: [], errors: [], talk: { origin: location.origin, secure: window.isSecureContext === true, mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia), mic: "not asked", audioContext: typeof AudioContext === "function", socket: "not asked" } };
    // Talk: can this webview reach the mic and the provider's socket at all? The runner's TCC answer decides "granted" or "NotAllowedError"; either name proves the call reached the system, while a TypeError or no mediaDevices is the failure.
    try {
      out.talk.mic = await Promise.race([navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) { s.getTracks().forEach(function (t) { t.stop(); }); return "granted"; }, function (e) { return e && e.name ? e.name : String(e); }), new Promise(function (r) { setTimeout(function () { r("no answer in 8s"); }, 8000); })]);
    } catch (e) { out.talk.mic = "threw: " + String(e); }
    try {
      out.talk.socket = await new Promise(function (r) { var s = new WebSocket("wss://api.deepgram.com/v1/listen", ["bearer", "ci-proof-not-a-token"]); var t = setTimeout(function () { r("no answer in 8s"); s.close(); }, 8000); s.onopen = function () { clearTimeout(t); r("open"); s.close(); }; s.onerror = function () { clearTimeout(t); r("reached and refused"); }; s.onclose = function (e) { clearTimeout(t); r("closed " + e.code); }; });
    } catch (e) { out.talk.socket = "threw: " + String(e); }
    try { out.personal = await inv("ensure_personal_space"); } catch (e) { out.errors.push("ensure_personal_space: " + String(e)); }
    try {
      out.sources = await inv("discover_session_sources");
      for (var i = 0; i < out.sources.length; i++) {
        try { out.reads.push(await inv("read_session_source", { sessionKey: out.sources[i].sessionKey })); } catch (e) { out.errors.push("read " + out.sources[i].sessionKey + ": " + String(e)); }
      }
    } catch (e) { out.errors.push("discover_session_sources: " + String(e)); }
    try { await post(out); } catch (e) { inv("page_report", { kind: "proof", text: "post failed: " + String(e) }); }
  })();
})();"#;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared: sidecar::Shared = Arc::new(sidecar::Sidecar::default());
    let exit_handle = shared.clone();
    let personal = Arc::new(sidecar::Sidecar::personal());
    let personal_exit = personal.clone();
    let server = Arc::new(sidecar::Sidecar::server());
    let server_exit = server.clone();

    let app = tauri::Builder::default()
        // Must be first so a second launch is caught before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            show_main(app);
            if let Some(link) = links::from_args(argv) {
                commands::deliver(app, link);
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_main(app);
                    }
                })
                .build(),
        )
        .on_page_load(|webview, payload| {
            if let tauri::webview::PageLoadEvent::Finished = payload.event() {
                // The window starts hidden (tauri.conf.json): the page's head script has by now put the saved skin and mode on the root, so the first frame the person sees is already themed.
                // On a Mac it is still almost transparent here, until FIRST_FRAME reports a drawn frame.
                let _ = webview.window().show();
                let _ = webview.eval(FIRST_FRAME);
                let _ = webview.eval(PAGE_PROBE);
                let _ = webview.eval(EXTERNAL_LINKS);
                let _ = webview.eval(NO_SERVICE_WORKER);
                if std::env::var("VYRE_SHELL_BANNER").is_ok() {
                    let _ = webview.eval(BANNER);
                }
                // Only a loopback collector address is ever put into the script.
                if let Ok(url) = std::env::var("VYRE_SHELL_PROOF_URL") {
                    if url.starts_with("http://127.0.0.1:") && url[17..].bytes().all(|b| b.is_ascii_digit()) {
                        let _ = webview.eval(PROOF.replace("__PROOF_URL__", &url));
                    }
                }
            }
        })
        .on_window_event(|window, event| {
            // A banner was shown a moment ago and the window comes forward: open what the banner was about (native.rs).
            if let tauri::WindowEvent::Focused(true) = event {
                native::on_focus(window.app_handle());
            }
        })
        .manage(updater::SharedUpdate::default())
        .manage(AppState { sidecar: shared.clone(), personal: personal.clone(), server: server.clone(), links: Mutex::new(commands::LinkHandoff::default()), native: native::NativeState::default() })
        .invoke_handler(tauri::generate_handler![
            first_frame,
            commands::desktop_info,
            commands::ensure_personal_space,
            commands::ensure_mac_server,
            commands::take_pending_link,
            commands::page_report,
            commands::open_link,
            updater::startup_update,
            updater::check_desktop_update,
            updater::install_desktop_update,
            native::notify,
            native::discover_codex_sessions,
            native::discover_session_sources,
            native::read_session_source,
            native::pick_paths,
            native::set_badge,
            chrome::install_chrome_extension,
            chrome::open_chrome_extensions,
            chrome::reveal_chrome_extension,
            chrome::link_chrome_space,
            chrome::unlink_chrome_space,
            winsandbox::windows_sandbox_state,
            winsandbox::setup_windows_sandbox
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            // The update check starts now, with the window, so its answer is usually there by the time the page asks for it before the lock screen (updater.rs).
            updater::start_check(&handle);

            #[cfg(target_os = "macos")]
            if let Some(w) = app.get_webview_window("main") {
                set_window_alpha(&w, WAITING_ALPHA);
            }

            // The window starts hidden so it never shows an unthemed frame (see on_page_load). If the page never finishes loading, it still comes forward after a few seconds, at full strength.
            {
                let late = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    if let Some(w) = late.get_webview_window("main") {
                        if !w.is_visible().unwrap_or(true) {
                            let _ = w.show();
                        }
                    }
                    raise_main(&late);
                });
            }

            // A shortcut another program already holds must not stop the shell.
            if let Err(e) = app.global_shortcut().register(SHORTCUT) {
                eprintln!("shortcut {SHORTCUT} not registered: {e}");
            }

            // Windows and Linux register the scheme at launch; on Mac it comes from the bundle.
            #[cfg(any(target_os = "linux", windows))]
            {
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("deep link scheme not registered: {e}");
                }
            }

            // The link the app was started with (launch arguments), then every later one.
            if let Some(link) = links::from_args(std::env::args()) {
                commands::deliver(&handle, link);
            }
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    if let Some(link) = links::parse(url.as_str()) {
                        commands::deliver(&handle, link);
                    }
                }
            }
            let on_open = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Some(link) = links::parse(url.as_str()) {
                        show_main(&on_open);
                        commands::deliver(&on_open, link);
                    }
                }
            });

            let state = app.state::<AppState>();
            if let Err(e) = native::setup_tray(&handle, &state.native) {
                eprintln!("tray not created: {e}");
            }
            sidecar::start(&handle, &state.sidecar, 0);
            if personal::profile_exists(&handle) { sidecar::start(&handle, &state.personal, 0); }
            if macserver::profile_exists(&handle) { sidecar::start(&handle, &state.server, 0); }
            Ok(())
        })
        .build(context())
        .expect("error while building vyre");

    app.run(move |_app, event| {
        if let RunEvent::Exit = event {
            sidecar::stop(&exit_handle);
            sidecar::stop(&personal_exit);
            sidecar::stop(&server_exit);
        }
    });
}

/// The app's compiled config and web build. The main window has dragDropEnabled off: a file dropped on the window then reaches the page as an ordinary drop with
/// its File objects (a Finder file, the screenshot thumbnail, an image from a browser), so the composer and every other field can take it. With Tauri's own drag
/// and drop on, the native view keeps the drop and the page never sees it.
fn context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

#[cfg(test)]
mod drop_tests {
    #[test]
    fn the_built_main_window_hands_file_drops_to_the_page() {
        let ctx = super::context();
        let main = ctx.config().app.windows.iter().find(|w| w.label == "main").expect("the main window is in the compiled config");
        assert!(!main.drag_drop_enabled, "the main window must have dragDropEnabled false, or files dropped on the app never reach the page");
    }
}
