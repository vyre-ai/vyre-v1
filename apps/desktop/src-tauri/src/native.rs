// Native features around the page (spec 2.24 and 3.13): the tray icon and its menu, OS notifications, the file and folder dialog, the Needs you badge.
// The page owns every decision (the rules for what may interrupt live in apps/desktop/src/notify.ts); this side shows what it is told and checks what comes back.
//   notify(title, body, link)   show an OS banner and remember its vyre://open link
//   pick_paths(options)         open the system dialog; absolute paths come back, nothing is read from them here
//   set_badge(count)            Needs you count in the tray menu, its tooltip and the dock/taskbar badge
// Desktop notification plugins report no click, so a click is read as the window coming forward soon after a banner (CLICK_WINDOW): the banner's link is then
// delivered like any other deep link (commands::deliver), once. Events: "vyre://tray" with "needs-you" when that tray item is chosen.

use crate::commands::{self, AppState};
use crate::links;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;

/// A window that comes forward within this long of a banner is read as the click on it (same number as CLICK_WINDOW_MS in notify.ts).
pub const CLICK_WINDOW: Duration = Duration::from_secs(30);
pub const TRAY_ID: &str = "vyre-tray";
pub const TRAY_EVENT: &str = "vyre://tray";
const MAX_TITLE: usize = 120;
const MAX_BODY: usize = 240;
const MAX_FILTERS: usize = 8;

pub struct Notice {
    pub link: String,
    pub at: Instant,
}

#[derive(Default)]
pub struct NativeState {
    pub last: Mutex<Option<Notice>>,
    pub needs: Mutex<Option<MenuItem<tauri::Wry>>>,
}

/// Printable text only, cut to `max` characters.
pub fn cut(s: &str, max: usize) -> String {
    s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect::<String>().trim().chars().take(max).collect()
}

/// True when `at` is no more than `window` before `now`.
pub fn fresh(at: Instant, now: Instant, window: Duration) -> bool {
    now.checked_duration_since(at).map_or(false, |d| d <= window)
}

pub fn needs_label(count: u32) -> String {
    if count > 0 {
        format!("Needs you ({count})")
    } else {
        "Needs you".to_string()
    }
}

pub fn tooltip(count: u32) -> String {
    match count {
        0 => "Vyre".to_string(),
        1 => "Vyre, 1 thing needs you".to_string(),
        n => format!("Vyre, {n} things need you"),
    }
}

/// Only a Vyre `open` link may ride on a banner.
pub fn open_link_ok(link: &str) -> bool {
    links::parse(link).map_or(false, |l| l.action == "open")
}

#[tauri::command]
pub fn notify(app: AppHandle, state: State<'_, AppState>, title: String, body: String, link: String) -> Result<(), String> {
    if !open_link_ok(&link) {
        return Err("a notification link must be a vyre://open link".to_string());
    }
    app.notification()
        .builder()
        .title(cut(&title, MAX_TITLE))
        .body(cut(&body, MAX_BODY))
        .show()
        .map_err(|e| e.to_string())?;
    if let Ok(mut last) = state.native.last.lock() {
        *last = Some(Notice { link, at: Instant::now() });
    }
    // Content never goes to a log: the fact only.
    println!("vyre-desktop: notification shown");
    Ok(())
}

/// The window came forward: if a banner was shown just before, open what it was about, once.
pub fn on_focus(app: &AppHandle) {
    let state = app.state::<AppState>();
    let notice = match state.native.last.lock() {
        Ok(mut last) => last.take(),
        Err(_) => None,
    };
    if let Some(n) = notice {
        if fresh(n.at, Instant::now(), CLICK_WINDOW) {
            if let Some(link) = links::parse(&n.link) {
                commands::deliver(app, link);
            }
        }
    }
}

#[derive(Deserialize)]
pub struct Filter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickOptions {
    pub title: String,
    pub multiple: bool,
    pub directory: bool,
    pub filters: Vec<Filter>,
    pub start_in: Option<String>,
}

/// Configuration supplied by the page. No transcript path is accepted from the page.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodexDiscoveryOptions {
    pub codex_home: Option<String>,
}

/// Metadata from Codex's state database. Transcript bodies remain unread until a user selects this source.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionSource {
    pub provider: &'static str,
    pub session_id: String,
    pub session_key: String,
    pub project_key: String,
    pub transcript_path: String,
    pub cwd: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub git_branch: Option<String>,
    pub git_origin_url: Option<String>,
}

/// Read `state_5.sqlite` only. SQLite opens it immutable when the platform accepts a file URI, then falls back to read-only.
#[tauri::command]
pub fn discover_codex_sessions(options: CodexDiscoveryOptions) -> Result<Vec<CodexSessionSource>, String> {
    let Some(root) = codex_root(options.codex_home.as_deref()) else { return Ok(Vec::new()); };
    let state = root.join("state_5.sqlite");
    if !contained_file(&root, &state) { return Ok(Vec::new()); }
    let db = open_codex_state(&state)?;
    let mut stmt = db.prepare("SELECT id, rollout_path, cwd, created_at, updated_at, git_branch, git_origin_url FROM threads")
        .map_err(|e| format!("cannot read Codex thread metadata: {e}"))?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?, row.get::<_, Option<String>>(4)?, row.get::<_, Option<String>>(5)?, row.get::<_, Option<String>>(6)?,
        ))
    }).map_err(|e| format!("cannot query Codex thread metadata: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, rollout, cwd, created_at, updated_at, git_branch, git_origin_url) = row.map_err(|e| e.to_string())?;
        let Some(rollout) = rollout else { continue; };
        let transcript = transcript_path(&root, &rollout);
        if !contained_file(&root, &transcript) { continue; }
        let project_key = cwd.as_deref().map(|value| format!("codex:{value}")).unwrap_or_else(|| "codex:unknown".to_string());
        out.push(CodexSessionSource { provider: "codex", session_key: format!("codex:{id}"), session_id: id, project_key, transcript_path: transcript.to_string_lossy().into_owned(), cwd, created_at, updated_at, git_branch, git_origin_url });
    }
    Ok(out)
}

fn codex_root(configured: Option<&str>) -> Option<PathBuf> {
    let root = configured.map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))?;
    root.canonicalize().ok().filter(|path| path.is_dir())
}

fn transcript_path(root: &Path, rollout: &str) -> PathBuf {
    let candidate = PathBuf::from(rollout);
    if candidate.is_absolute() { candidate } else { root.join(candidate) }
}

fn contained_file(root: &Path, candidate: &Path) -> bool {
    let Ok(real) = candidate.canonicalize() else { return false; };
    real.is_file() && real.starts_with(root)
}

fn open_codex_state(path: &Path) -> Result<Connection, String> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI;
    let immutable = format!("file:{}?immutable=1", path.to_string_lossy());
    Connection::open_with_flags(&immutable, flags)
        .or_else(|_| Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY))
        .map_err(|e| format!("cannot open Codex state read-only: {e}"))
}

#[tauri::command]
pub async fn pick_paths(app: AppHandle, options: PickOptions) -> Result<Vec<String>, String> {
    let mut dialog = app.dialog().file().set_title(cut(&options.title, 80));
    if let Some(dir) = &options.start_in {
        dialog = dialog.set_directory(dir);
    }
    let picked: Vec<tauri_plugin_dialog::FilePath> = if options.directory {
        dialog.blocking_pick_folder().into_iter().collect()
    } else {
        for f in options.filters.iter().take(MAX_FILTERS) {
            let exts: Vec<&str> = f.extensions.iter().map(|e| e.as_str()).collect();
            dialog = dialog.add_filter(cut(&f.name, 40), &exts);
        }
        if options.multiple {
            dialog.blocking_pick_files().unwrap_or_default()
        } else {
            dialog.blocking_pick_file().into_iter().collect()
        }
    };
    Ok(picked.into_iter().filter_map(|f| f.into_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect())
}

#[tauri::command]
pub fn set_badge(app: AppHandle, state: State<'_, AppState>, count: u32) {
    if let Ok(item) = state.native.needs.lock() {
        if let Some(item) = item.as_ref() {
            let _ = item.set_text(needs_label(count));
            let _ = item.set_enabled(count > 0);
        }
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(tooltip(count)));
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_badge_count(if count > 0 { Some(i64::from(count)) } else { None });
    }
}

/// The tray (Windows, Linux) or menu-bar (Mac) icon: Open/Hide, Needs you, Quit. A left click toggles the window.
pub fn setup_tray(app: &AppHandle, native: &NativeState) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Vyre", true, None::<&str>)?;
    let needs = MenuItem::with_id(app, "needs", needs_label(0), false, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Vyre", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &needs, &sep, &quit])?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(tooltip(0))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => crate::toggle_main(app),
            "needs" => {
                crate::show_main(app);
                let _ = app.emit(TRAY_EVENT, "needs-you");
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                crate::toggle_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    if let Ok(mut slot) = native.needs.lock() {
        *slot = Some(needs);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_banner_is_fresh_for_the_click_window_only() {
        let t0 = Instant::now();
        assert!(fresh(t0, t0, CLICK_WINDOW));
        assert!(fresh(t0, t0 + Duration::from_secs(30), CLICK_WINDOW));
        assert!(!fresh(t0, t0 + Duration::from_secs(31), CLICK_WINDOW));
        assert!(!fresh(t0 + Duration::from_secs(5), t0, CLICK_WINDOW), "a time before the banner is never a click");
    }

    #[test]
    fn only_vyre_open_links_ride_on_a_banner() {
        assert!(open_link_ok("vyre://open?space=acme&thread=t1"));
        for bad in ["vyre://join?code=1", "https://example.com", "vyre://open?a=%zz", ""] {
            assert!(!open_link_ok(bad), "{bad}");
        }
    }

    #[test]
    fn text_is_cut_and_stripped() {
        assert_eq!(cut("  a\nb\tc  ", 10), "a b c");
        assert_eq!(cut("abcdef", 3), "abc");
    }

    #[test]
    fn labels_follow_the_count() {
        assert_eq!(needs_label(0), "Needs you");
        assert_eq!(needs_label(4), "Needs you (4)");
        assert_eq!(tooltip(0), "Vyre");
        assert_eq!(tooltip(1), "Vyre, 1 thing needs you");
        assert_eq!(tooltip(3), "Vyre, 3 things need you");
    }
}
