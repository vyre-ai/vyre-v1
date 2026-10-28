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
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::Mutex;
use std::io::Read;
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
const MAX_SESSION_BYTES: u64 = 8 * 1024 * 1024;
const MAX_SUBAGENTS: usize = 64;
const MAX_REPO_PROBES: usize = 128;
const REPO_DISCOVERY_BUDGET: Duration = Duration::from_secs(5);

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

/// Fixture-only provider roots used by native unit tests. Renderer commands always resolve the packaged app's fixed provider roots.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodexDiscoveryOptions {
    pub codex_home: Option<String>,
    pub claude_home: Option<String>,
    pub claude_desktop_home: Option<String>,
}

/// Provider metadata returned behind an opaque session key. The native transcript path is never serialized to the renderer.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSource {
    pub provider: String,
    pub session_id: String,
    pub session_key: String,
    pub project_key: String,
    #[serde(skip_serializing)]
    pub transcript_path: String,
    pub cwd: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub git_branch: Option<String>,
    pub git_origin_url: Option<String>,
    /// True only after native code has resolved or rejected local repository identity.
    pub repository_metadata_authoritative: bool,
}

#[derive(Serialize)]
pub struct SessionDocument {
    pub namespace: String,
    pub text: String,
}

/// Read `state_5.sqlite` only, through SQLite's immutable file URI.
#[tauri::command]
pub async fn discover_codex_sessions() -> Result<Vec<SessionSource>, String> {
    tauri::async_runtime::spawn_blocking(|| codex_sources(None)).await.map_err(|_| "Local session discovery stopped unexpectedly.".to_string())?
}

/// Metadata-only source discovery for packaged clients. Provider roots are resolved independently and transcript bodies are never opened here.
#[tauri::command]
pub async fn discover_session_sources() -> Result<Vec<SessionSource>, String> {
    let sources = tauri::async_runtime::spawn_blocking(|| discover_session_sources_at(CodexDiscoveryOptions::default())).await.map_err(|_| "Local session discovery stopped unexpectedly.".to_string())?;
    Ok(sources)
}

fn discover_session_sources_at(options: CodexDiscoveryOptions) -> Vec<SessionSource> {
    let mut repos = RepoProbeCache::new();
    // A damaged or mid-upgrade Codex database must not hide an otherwise valid Claude store.
    let mut out = codex_sources_with_repos(options.codex_home.as_deref(), &mut repos).unwrap_or_default();
    out.extend(claude_sources_with_repos(options.claude_home.as_deref(), options.claude_desktop_home.as_deref(), &mut repos));
    out.sort_by(|a, b| a.session_key.cmp(&b.session_key));
    out
}

/// Only a discovered provider source key crosses the read boundary, never a page-supplied path.
#[tauri::command]
pub async fn read_session_source(session_key: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || read_session_source_at(session_key)).await.map_err(|_| "The selected session could not be read.".to_string())?
}

fn read_session_source_at(session_key: String) -> Result<serde_json::Value, String> {
    let sources = discover_session_sources_at(CodexDiscoveryOptions::default());
    let source = sources.into_iter().find(|s| s.session_key == session_key).ok_or("Choose a discovered local session first.")?;
    let root = if source.provider == "codex" { codex_root(None) } else { claude_root(None) }.ok_or("The provider folder is unavailable.")?;
    read_discovered_source(&source, &root)
}

fn read_discovered_source(source: &SessionSource, root: &Path) -> Result<serde_json::Value, String> {
    let file = PathBuf::from(&source.transcript_path).canonicalize().map_err(|_| "The transcript is unavailable.")?;
    if !contained_file(&root, &file) { return Err("The transcript is outside its provider folder.".into()); }
    let mut remaining = MAX_SESSION_BYTES;
    let mut documents = vec![SessionDocument { namespace: "main".into(), text: read_session_text(&file, &mut remaining)? }];
    let mut selected = source.clone();
    if source.provider == "claude" {
        if let Some(cwd) = claude_cwd(&documents[0].text) {
            if let Some((repo_root, remote)) = local_repo_metadata(&cwd) {
                selected.cwd = Some(repo_root);
                selected.git_origin_url = remote.or(selected.git_origin_url);
            }
        }
        let children = claude_subagent_files(root, &file);
        if children.len() > MAX_SUBAGENTS { return Err(format!("This session has more than {MAX_SUBAGENTS} subagent transcripts.")); }
        for child in children {
            let id = claude_session_id(child.file_name().and_then(|name| name.to_str())).ok_or("A subagent transcript has an invalid name.")?;
            documents.push(SessionDocument { namespace: format!("subagent:{id}"), text: read_session_text(&child, &mut remaining)? });
        }
    }
    selected.repository_metadata_authoritative = true;
    Ok(serde_json::json!({ "source": selected, "documents": documents }))
}

fn claude_cwd(text: &str) -> Option<String> {
    for line in text.lines().take(256) {
        if line.len() > 64 * 1024 { continue; }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else { continue; };
        if let Some(cwd) = value.get("cwd").and_then(|item| item.as_str()).filter(|item| item.len() <= 4096) { return Some(cwd.to_string()); }
    }
    None
}

fn read_session_text(file: &Path, remaining: &mut u64) -> Result<String, String> {
    let reader = fs::File::open(file).map_err(|_| "The transcript is unavailable.")?;
    let mut bytes = Vec::new();
    if file.extension().and_then(|s| s.to_str()) == Some("gz") {
        flate2::read::GzDecoder::new(reader).take(*remaining + 1).read_to_end(&mut bytes).map_err(|_| "Cannot decode the transcript.")?;
    } else { reader.take(*remaining + 1).read_to_end(&mut bytes).map_err(|_| "Cannot read the transcript.")?; }
    if bytes.len() as u64 > *remaining { return Err("Choose a session whose combined transcripts are smaller than 8 MB.".into()); }
    *remaining -= bytes.len() as u64;
    String::from_utf8(bytes).map_err(|_| "The transcript is not UTF-8 text.".into())
}

fn claude_subagent_files(root: &Path, parent: &Path) -> Vec<PathBuf> {
    let name = parent.file_name().and_then(|value| value.to_str()).unwrap_or("").trim_end_matches(".gz").trim_end_matches(".jsonl");
    let Some(project) = parent.parent() else { return Vec::new(); };
    let mut files = contained_files(root, &project.join(name).join("subagents"));
    files.retain(|file| file.file_name().and_then(|value| value.to_str()).and_then(|value| value.strip_prefix("agent-")).and_then(|value| claude_session_id(Some(value))).is_some());
    files.sort();
    files
}

fn codex_sources(configured: Option<&str>) -> Result<Vec<SessionSource>, String> {
    codex_sources_with_repos(configured, &mut RepoProbeCache::new())
}

fn codex_sources_with_repos(configured: Option<&str>, repos: &mut RepoProbeCache) -> Result<Vec<SessionSource>, String> {
    let Some(root) = codex_root(configured) else { return Ok(Vec::new()); };
    let state = root.join("state_5.sqlite");
    if !contained_file(&root, &state) { return Ok(Vec::new()); }
    let db = open_codex_state(&state)?;
    let mut stmt = db.prepare("SELECT id, rollout_path, cwd, CAST(created_at AS TEXT), CAST(updated_at AS TEXT), git_branch, git_origin_url FROM threads")
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
        let safe_remote = safe_git_remote(git_origin_url);
        let repo = cwd.as_deref().and_then(|value| repos.resolve(value));
        let normalized_cwd = repo.as_ref().map(|value| value.0.clone()).or(cwd);
        let normalized_remote = repo.and_then(|value| value.1.or(safe_remote));
        let project_key = normalized_cwd.as_deref().map(|value| format!("codex:{value}")).unwrap_or_else(|| "codex:unknown".to_string());
        out.push(SessionSource { provider: "codex".to_string(), session_key: format!("codex:{id}"), session_id: id, project_key, transcript_path: transcript.to_string_lossy().into_owned(), cwd: normalized_cwd, created_at, updated_at, git_branch, git_origin_url: normalized_remote, repository_metadata_authoritative: false });
    }
    Ok(out)
}

fn claude_sources(configured: Option<&str>, configured_desktop: Option<&str>) -> Vec<SessionSource> {
    claude_sources_with_repos(configured, configured_desktop, &mut RepoProbeCache::new())
}

fn claude_sources_with_repos(configured: Option<&str>, configured_desktop: Option<&str>, repos: &mut RepoProbeCache) -> Vec<SessionSource> {
    let Some(root) = claude_root(configured) else { return Vec::new(); };
    // Claude Desktop lives outside ~/.claude. It receives its own containment root, never the provider root.
    let metadata = claude_desktop_metadata(claude_desktop_root(configured_desktop));
    let mut out = Vec::new();
    for area in ["projects", "projects-archive"] {
        let base = root.join(area);
        for file in contained_files(&root, &base) {
            let Ok(relative) = file.strip_prefix(&base) else { continue; };
            if relative.components().count() != 2 { continue; }
            let Some(id) = claude_session_id(file.file_name().and_then(|name| name.to_str())) else { continue; };
            let project = file.strip_prefix(&base).ok().and_then(|relative| relative.components().next()).and_then(|part| part.as_os_str().to_str()).unwrap_or("unknown");
            let extra = metadata.get(&id);
            let repo = extra.and_then(|value| value.0.as_deref()).and_then(|cwd| repos.resolve(cwd));
            out.push(SessionSource {
                provider: "claude".to_string(), session_key: format!("claude:{id}"), session_id: id,
                project_key: format!("claude:{project}"), transcript_path: file.to_string_lossy().into_owned(),
                cwd: repo.as_ref().map(|value| value.0.clone()).or_else(|| extra.and_then(|value| value.0.clone())), created_at: None, updated_at: extra.and_then(|value| value.1.clone()), git_branch: None, git_origin_url: repo.and_then(|value| value.1), repository_metadata_authoritative: false,
            });
        }
    }
    out.sort_by(|a, b| a.session_key.cmp(&b.session_key));
    out.dedup_by(|a, b| a.session_key == b.session_key);
    out
}

struct RepoProbeCache {
    values: HashMap<String, Option<(String, Option<String>)>>,
    remaining: usize,
    deadline: Instant,
}

impl RepoProbeCache {
    fn new() -> Self {
        Self { values: HashMap::new(), remaining: MAX_REPO_PROBES, deadline: Instant::now() + REPO_DISCOVERY_BUDGET }
    }

    fn resolve(&mut self, cwd: &str) -> Option<(String, Option<String>)> {
        if let Some(found) = self.values.get(cwd) { return found.clone(); }
        if self.remaining == 0 || Instant::now() >= self.deadline { return None; }
        self.remaining -= 1;
        let found = local_repo_metadata_until(cwd, self.deadline);
        self.values.insert(cwd.to_string(), found.clone());
        found
    }
}

fn local_repo_metadata(cwd: &str) -> Option<(String, Option<String>)> {
    local_repo_metadata_until(cwd, Instant::now() + Duration::from_secs(2))
}

fn local_repo_metadata_until(cwd: &str, deadline: Instant) -> Option<(String, Option<String>)> {
    let cwd = PathBuf::from(cwd).canonicalize().ok().filter(|path| path.is_dir())?;
    let root = git_output(&cwd, &["rev-parse", "--show-toplevel"], deadline)?;
    if !root.status.success() { return None; }
    let root = String::from_utf8(root.stdout).ok()?.trim().to_string();
    if root.is_empty() { return None; }
    let remote = git_output(&cwd, &["config", "--get", "remote.origin.url"], deadline)
        .filter(|output| output.status.success()).and_then(|output| String::from_utf8(output.stdout).ok()).map(|value| value.trim().to_string()).filter(|value| !value.is_empty() && value.len() <= 2048);
    Some((root, safe_git_remote(remote)))
}

fn git_output(cwd: &Path, args: &[&str], budget_deadline: Instant) -> Option<Output> {
    let mut child = Command::new("git").arg("-C").arg(cwd).args(args).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let deadline = std::cmp::min(Instant::now() + Duration::from_secs(2), budget_deadline);
    loop {
        if child.try_wait().ok()?.is_some() { return child.wait_with_output().ok(); }
        if Instant::now() >= deadline { let _ = child.kill(); let _ = child.wait(); return None; }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn claude_root(configured: Option<&str>) -> Option<PathBuf> {
    configured.map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".claude")))?.canonicalize().ok().filter(|path| path.is_dir())
}

fn claude_desktop_root(configured: Option<&str>) -> Option<PathBuf> {
    configured.map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library").join("Application Support").join("Claude")))?.canonicalize().ok().filter(|path| path.is_dir())
}

fn claude_desktop_metadata(root: Option<PathBuf>) -> HashMap<String, (Option<String>, Option<String>)> {
    let Some(root) = root else { return HashMap::new(); };
    let mut out = HashMap::new();
    for folder in ["claude-code-sessions", "local-agent-mode-sessions"] {
        for file in contained_files(&root, &root.join(folder)) {
            let Some(name) = file.file_name().and_then(|name| name.to_str()) else { continue; };
            if !name.starts_with("local_") || !name.ends_with(".json") { continue; }
            let Ok(text) = fs::read_to_string(file) else { continue; };
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else { continue; };
            let Some(id) = value.get("sessionId").and_then(|value| value.as_str()) else { continue; };
            let cwd = value.get("cwd").and_then(|value| value.as_str()).map(ToOwned::to_owned);
            let updated = value.get("updatedAt").and_then(|value| value.as_str()).map(ToOwned::to_owned);
            out.insert(id.to_ascii_lowercase(), (cwd, updated));
        }
    }
    out
}

fn contained_files(root: &Path, start: &Path) -> Vec<PathBuf> {
    let Ok(base) = root.canonicalize() else { return Vec::new(); };
    let Ok(start) = start.canonicalize() else { return Vec::new(); };
    if !start.starts_with(&base) { return Vec::new(); }
    let mut out = Vec::new();
    let mut walk = vec![start];
    while let Some(dir) = walk.pop() {
        let Ok(entries) = fs::read_dir(dir) else { continue; };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else { continue; };
            if kind.is_symlink() { continue; }
            if kind.is_dir() { walk.push(entry.path()); }
            else if kind.is_file() {
                if let Ok(real) = entry.path().canonicalize() { if real.starts_with(&base) { out.push(real); } }
            }
        }
    }
    out
}

fn claude_session_id(name: Option<&str>) -> Option<String> {
    let mut stem = name?.strip_suffix(".gz").unwrap_or(name?);
    stem = stem.strip_suffix(".jsonl")?;
    let id = stem.strip_prefix("agent-").unwrap_or(stem);
    let valid = id.len() == 36 && id.chars().enumerate().all(|(index, ch)| match index { 8 | 13 | 18 | 23 => ch == '-', _ => ch.is_ascii_hexdigit() });
    valid.then(|| id.to_ascii_lowercase())
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
    let immutable = immutable_sqlite_uri(path);
    Connection::open_with_flags(&immutable, flags).map_err(|e| format!("cannot open immutable Codex state: {e}"))
}

/// SQLite URI paths treat `?`, `#` and `%` as syntax, so every non-path-safe byte is percent encoded before immutable mode is requested.
fn immutable_sqlite_uri(path: &Path) -> String {
    let display = path.to_string_lossy().replace('\\', "/");
    let mut encoded = String::with_capacity(display.len());
    for byte in display.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/') { encoded.push(char::from(byte)); }
        else { encoded.push_str(&format!("%{byte:02X}")); }
    }
    format!("file://{encoded}?immutable=1")
}

/// Git URLs may embed a token or password as userinfo. Preserve the host/path mapping but never return that material to the page.
fn safe_git_remote(raw: Option<String>) -> Option<String> {
    raw.map(|value| {
        if value.starts_with("git@") { return value; }
        if let Some(scheme_end) = value.find("://") {
            let rest = &value[scheme_end + 3..];
            let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
            let authority = &rest[..authority_end];
            if let Some(at) = authority.rfind('@') {
                return format!("{}://{}{}", &value[..scheme_end], &authority[at + 1..], &rest[authority_end..]);
            }
            return value;
        }
        if let Some(at) = value.find('@') {
            if value[at + 1..].contains(':') { return value[at + 1..].to_string(); }
        }
        value
    })
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

    #[test]
    fn selected_transcript_reads_gzip_and_rejects_outside_paths() {
        use std::io::Write;
        let root = std::env::temp_dir().join(format!("vyre-session-read-fixture-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let file = root.join("session.jsonl.gz");
        let mut zipped = flate2::write::GzEncoder::new(fs::File::create(&file).unwrap(), flate2::Compression::default());
        zipped.write_all(b"{\"visible\":true}\n").unwrap();
        zipped.finish().unwrap();
        let source = SessionSource { provider: "claude".into(), session_id: "fixture".into(), session_key: "claude:fixture".into(), project_key: "unknown".into(), transcript_path: file.to_string_lossy().into(), cwd: None, created_at: None, updated_at: None, git_branch: None, git_origin_url: None, repository_metadata_authoritative: false };
        let value = read_discovered_source(&source, &root).unwrap();
        assert_eq!(value["documents"][0]["text"], "{\"visible\":true}\n");
        assert_eq!(value["source"]["repositoryMetadataAuthoritative"], true);
        assert!(read_discovered_source(&source, &root.join("other")).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn integer_codex_metadata_keeps_safe_ssh_remote() {
        let root = std::env::temp_dir().join(format!("vyre-codex-fixture-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("rollout.jsonl"), "{}\n").unwrap();
        let db = Connection::open(root.join("state_5.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE threads(id TEXT, rollout_path TEXT, cwd TEXT, created_at INTEGER, updated_at INTEGER, git_branch TEXT, git_origin_url TEXT); INSERT INTO threads VALUES ('fixture','rollout.jsonl','/work/app',1760000000,1760000001,'main','git@github.com:acme/app.git');").unwrap();
        drop(db);
        let sources = codex_sources(Some(root.to_str().unwrap())).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].created_at.as_deref(), Some("1760000000"));
        assert_eq!(sources[0].git_origin_url.as_deref(), Some("git@github.com:acme/app.git"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn immutable_sqlite_uri_escapes_path_delimiters() {
        assert_eq!(immutable_sqlite_uri(Path::new("/tmp/a b?#%.sqlite")), "file:///tmp/a%20b%3F%23%25.sqlite?immutable=1");
    }

    #[test]
    fn git_remote_never_carries_userinfo_into_session_metadata() {
        assert_eq!(safe_git_remote(Some("https://token:secret@example.com/acme/vyre.git".to_string())), Some("https://example.com/acme/vyre.git".to_string()));
        assert_eq!(safe_git_remote(Some("git@github.com:acme/vyre.git".to_string())), Some("git@github.com:acme/vyre.git".to_string()));
        assert_eq!(safe_git_remote(Some("https://github.com/acme/vyre.git".to_string())), Some("https://github.com/acme/vyre.git".to_string()));
    }

    #[test]
    fn claude_discovery_keeps_parent_only_and_enriches_it_from_the_local_repo() {
        let fixture = std::env::temp_dir().join(format!("vyre-claude-parent-fixture-{}", std::process::id()));
        let claude = fixture.join(".claude");
        let project = claude.join("projects").join("-work-vyre");
        let parent = "22222222-2222-4222-8222-222222222222";
        let child = "33333333-3333-4333-8333-333333333333";
        let repo = fixture.join("work").join("vyre");
        fs::create_dir_all(repo.join("packages").join("app")).unwrap();
        assert!(Command::new("git").arg("init").arg(&repo).output().unwrap().status.success());
        assert!(Command::new("git").arg("-C").arg(&repo).args(["remote", "add", "origin", "https://token:secret@example.com/acme/vyre.git"]).output().unwrap().status.success());
        fs::create_dir_all(project.join(parent).join("subagents")).unwrap();
        fs::write(project.join(format!("{parent}.jsonl")), format!(r#"{{"type":"user","cwd":{},"message":{{"role":"user","content":"Parent"}}}}\n"#, serde_json::to_string(repo.join("packages").join("app").to_str().unwrap()).unwrap())).unwrap();
        fs::write(project.join(parent).join("subagents").join(format!("agent-{child}.jsonl")), "{}\n").unwrap();
        let sources = claude_sources(Some(claude.to_str().unwrap()), None);
        assert_eq!(sources.len(), 1, "subagents belong to their parent and are not selectable sessions");
        assert_eq!(sources[0].session_id, parent);
        assert_eq!(sources[0].git_origin_url, None, "discovery does not read transcript metadata");
        assert_eq!(sources[0].cwd, None, "CLI-only Claude Code has no Desktop metadata");
        let root = claude.canonicalize().unwrap();
        let read = read_discovered_source(&sources[0], &root).unwrap();
        assert_eq!(read["documents"].as_array().map(Vec::len), Some(2));
        assert_eq!(read["documents"][1]["namespace"], format!("subagent:{child}"));
        assert_eq!(read["source"]["cwd"], repo.to_str().unwrap());
        assert_eq!(read["source"]["gitOriginUrl"], "https://example.com/acme/vyre.git");
        assert_eq!(read["source"]["repositoryMetadataAuthoritative"], true);
        let codex = fixture.join(".codex");
        fs::create_dir_all(&codex).unwrap();
        fs::write(codex.join("rollout.jsonl"), "{}\n").unwrap();
        let db = Connection::open(codex.join("state_5.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE threads(id TEXT, rollout_path TEXT, cwd TEXT, created_at INTEGER, updated_at INTEGER, git_branch TEXT, git_origin_url TEXT);").unwrap();
        db.execute("INSERT INTO threads VALUES (?1,?2,?3,?4,?5,?6,?7)", rusqlite::params!["fixture", "rollout.jsonl", repo.join("packages").join("app").to_str().unwrap(), 1, 2, "main", "https://fallback.example/acme/vyre.git"]).unwrap();
        db.execute("INSERT INTO threads VALUES (?1,?2,?3,?4,?5,?6,?7)", rusqlite::params!["missing", "rollout.jsonl", fixture.join("deleted-repo").to_str().unwrap(), 1, 2, "main", "https://example.com/acme/deleted.git"]).unwrap();
        drop(db);
        let codex_sources = codex_sources(Some(codex.to_str().unwrap())).unwrap();
        let codex_source = codex_sources.iter().find(|source| source.session_id == "fixture").unwrap().clone();
        assert_eq!(codex_source.cwd.as_deref(), repo.to_str());
        assert_eq!(codex_source.git_origin_url.as_deref(), Some("https://example.com/acme/vyre.git"));
        assert_eq!(read["source"]["cwd"], codex_source.cwd.clone().unwrap());
        assert_eq!(read["source"]["gitOriginUrl"], codex_source.git_origin_url.clone().unwrap());
        let missing = codex_sources.iter().find(|source| source.session_id == "missing").unwrap();
        assert_eq!(missing.git_origin_url, None, "a deleted checkout cannot create a repository Project from stale metadata");
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn corrupt_codex_state_does_not_hide_claude_sources() {
        let fixture = std::env::temp_dir().join(format!("vyre-provider-failure-fixture-{}", std::process::id()));
        let codex = fixture.join(".codex");
        let claude = fixture.join(".claude");
        fs::create_dir_all(&codex).unwrap();
        fs::write(codex.join("state_5.sqlite"), "not sqlite").unwrap();
        let project = claude.join("projects").join("-work-vyre");
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join("44444444-4444-4444-8444-444444444444.jsonl"), "{}\n").unwrap();
        let sources = discover_session_sources_at(CodexDiscoveryOptions { codex_home: Some(codex.to_string_lossy().into()), claude_home: Some(claude.to_string_lossy().into()), claude_desktop_home: None });
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].provider, "claude");
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn repository_discovery_stops_when_its_shared_probe_budget_is_spent() {
        let mut repos = RepoProbeCache { values: HashMap::new(), remaining: 0, deadline: Instant::now() + Duration::from_secs(1) };
        assert_eq!(repos.resolve("/"), None);
        assert!(repos.values.is_empty(), "an exhausted store never starts another filesystem or Git probe");
    }
}
