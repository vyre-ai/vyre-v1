// The desktop app updates itself (V1-SPEC 3.13; owner, 3 Nov: "on startup, it finds a new update and just updates itself"). Tauri's updater reads a JSON feed from the GitHub release the app came
// from, downloads the bundle it names for this platform, checks its minisign signature against the release key pinned in tauri.conf.json and installs it. The feed and the signatures are made by
// scripts/release/updater.ts in the isolated sign job; the app adds no secret. A prerelease build (1.0.0-rc.3) reads the beta channel, a release build the stable one, the same split the servers use.
//
//   at launch (setup in lib.rs) the shell starts one check with a short timeout; the page asks for its answer before the lock screen (startup_update) and waits only a moment for it
//   the page decides (startup/update in the app): with "Update Vyre automatically" on and a newer version it shows the Updating screen and calls install_desktop_update; otherwise the answer only
//   lights Settings
//   install: download with progress (vyre://update-progress), the signature checked against the pinned key, then nothing running here (every daemon is asked what runs: a turn that can go on on
//   the server is handed over, one that cannot is waited for), every daemon stopped and its process gone, the bundle installed, the app restarted. A failure before the restart starts the daemons
//   again and comes back as one line; the next start tries again.
// The page passes nothing but how long to wait: what is installed and from where is decided here.
use serde::Serialize;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

const FEED_STABLE: &str = "https://github.com/vyre-ai/vyre-v1/releases/latest/download/desktop-stable.json";
const FEED_BETA: &str = "https://github.com/vyre-ai/vyre-v1/releases/download/channel-beta/desktop-beta.json";
pub const PROGRESS_EVENT: &str = "vyre://update-progress";
/// The startup check gives up after this, so an offline or slow network never holds anything.
const CHECK_TIMEOUT: Duration = Duration::from_secs(8);
/// The most the page may wait for the startup check.
const MAX_WAIT: Duration = Duration::from_secs(10);
/// How long the update waits for chat turns on this computer to finish. When it runs out, or the person presses "Stop and update now", the running turns are ended cleanly and the update goes on:
/// the wait is never open ended.
const TURN_WAIT: Duration = Duration::from_secs(10 * 60);
/// After the turns were told to stop: how long they get to end before the daemons are stopped anyway (a turn a daemon had not ended is picked up again when it starts).
const STOP_TURNS_GRACE: Duration = Duration::from_secs(10);
/// How long a daemon has to end after it was asked to stop, before it is killed.
const STOP_WAIT: Duration = Duration::from_secs(15);

/// `beta` for a prerelease version, `stable` for a release.
pub(crate) fn channel_of(version: &str) -> &'static str {
    if version.contains('-') { "beta" } else { "stable" }
}

pub(crate) fn feed_url(channel: &str) -> &'static str {
    if channel == "beta" { FEED_BETA } else { FEED_STABLE }
}

/// The CI proof points the app at a feed of its own (VYRE_UPDATE_FEED). Only an address in Vyre's own repository is taken, and the bundle it names must still carry a signature from the pinned
/// release key, so the most it can do is offer an older signed release; anyone who can set this app's environment can already run anything as the person.
pub(crate) fn feed_override(v: Option<String>) -> Option<String> {
    let v = v?;
    let ours = ["https://raw.githubusercontent.com/vyre-ai/vyre-v1/", "https://github.com/vyre-ai/vyre-v1/releases/download/"].iter().any(|p| v.starts_with(p));
    (ours && v.len() < 400 && !v.contains("..") && !v.contains('@') && v.parse::<Url>().is_ok()).then_some(v)
}

/// CI and the test runs of a built app switch the startup check off (VYRE_NO_AUTO_UPDATE=1), so a build never updates itself in the middle of its own tests.
fn startup_off() -> bool {
    std::env::var("VYRE_NO_AUTO_UPDATE").map(|v| v == "1").unwrap_or(false)
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Phase { Checking, None, Available, Failed }

/// What the startup check (or the last Check now) knows: `checking` until it answers.
pub(crate) fn phase_of(done: bool, failed: bool, found: bool) -> Phase {
    if !done { Phase::Checking } else if found { Phase::Available } else if failed { Phase::Failed } else { Phase::None }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdate {
    pub phase: Phase,
    pub current: String,
    pub channel: String,
    /// The newer version, when there is one.
    pub version: Option<String>,
    pub notes: Option<String>,
    /// When the last check answered, ms since 1970.
    pub checked_at: Option<u64>,
}

#[derive(Default)]
struct Inner { done: bool, failed: bool, found: Option<Update>, checked_at: Option<u64>, installing: bool, stop_now: bool }

/// The app's one record of updates, shared by the startup check, Check now and the install.
#[derive(Default)]
pub struct UpdateState { inner: Mutex<Inner>, cv: Condvar }
pub type SharedUpdate = Arc<UpdateState>;

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }

impl UpdateState {
    fn record(&self, r: &Result<Option<Update>, String>) {
        if let Ok(mut i) = self.inner.lock() {
            i.done = true;
            i.checked_at = Some(now_ms());
            match r { Ok(found) => { i.failed = false; i.found = found.clone(); } Err(_) => { i.failed = true; } }
        }
        self.cv.notify_all();
    }
    /// The startup check is switched off: nothing to wait for.
    fn record_off(&self) {
        if let Ok(mut i) = self.inner.lock() { i.done = true; }
        self.cv.notify_all();
    }
    /// Wait until the check has answered, at most `wait`.
    fn wait(&self, wait: Duration) {
        let begun = Instant::now();
        let Ok(mut g) = self.inner.lock() else { return };
        while !g.done {
            let left = wait.saturating_sub(begun.elapsed());
            if left.is_zero() { break; }
            g = match self.cv.wait_timeout(g, left) { Ok((g, _)) => g, Err(_) => return };
        }
    }
    fn describe(&self, current: &str) -> DesktopUpdate {
        let g = self.inner.lock().ok();
        let (done, failed, found, at) = g.as_ref().map(|i| (i.done, i.failed, i.found.clone(), i.checked_at)).unwrap_or((false, false, None, None));
        DesktopUpdate { phase: phase_of(done, failed, found.is_some()), current: current.to_string(), channel: channel_of(current).to_string(), version: found.as_ref().map(|u| u.version.clone()), notes: found.and_then(|u| u.body), checked_at: at }
    }
    fn found(&self) -> Option<Update> { self.inner.lock().ok().and_then(|i| i.found.clone()) }
    fn begin_install(&self) -> bool {
        let Ok(mut i) = self.inner.lock() else { return false };
        if i.installing { return false; }
        i.installing = true;
        i.stop_now = false;
        true
    }
    /// "Stop and update now": the wait for running replies ends at its next look.
    fn request_stop_now(&self) -> bool {
        let Ok(mut i) = self.inner.lock() else { return false };
        if !i.installing { return false; }
        i.stop_now = true;
        true
    }
    fn stop_now_requested(&self) -> bool { self.inner.lock().map(|i| i.stop_now).unwrap_or(false) }
    fn end_install(&self) { if let Ok(mut i) = self.inner.lock() { i.installing = false; } }
}

fn shared(app: &AppHandle) -> SharedUpdate { app.state::<SharedUpdate>().inner().clone() }
fn current_version(app: &AppHandle) -> String { app.package_info().version.to_string() }

fn updater(app: &AppHandle, timeout: Option<Duration>) -> Result<tauri_plugin_updater::Updater, String> {
    let channel = channel_of(&current_version(app));
    let feed = feed_override(std::env::var("VYRE_UPDATE_FEED").ok()).unwrap_or_else(|| feed_url(channel).to_string());
    let url: Url = feed.parse().map_err(|_| "The update address is not valid".to_string())?;
    let mut b = app.updater_builder().endpoints(vec![url]).map_err(|e| e.to_string())?;
    if let Some(t) = timeout { b = b.timeout(t); }
    b.build().map_err(|e| e.to_string())
}

const UNREACHABLE: &str = "Couldn't reach the update server. Check your connection and try again.";

async fn run_check(app: &AppHandle) -> Result<Option<Update>, String> {
    let found = updater(app, Some(CHECK_TIMEOUT))?.check().await.map_err(|e| { println!("vyre-desktop: update: check failed: {e}"); UNREACHABLE.to_string() })?;
    if let Some(u) = &found { println!("vyre-desktop: update: {} is available (this is {})", u.version, u.current_version); }
    Ok(found)
}

/// At launch: one check in the background, whose answer the page reads before the lock screen.
pub fn start_check(app: &AppHandle) {
    let st = shared(app);
    if startup_off() { st.record_off(); return; }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let r = run_check(&app).await;
        st.record(&r);
    });
}

/// The startup check's answer, waiting at most `wait_ms` (and never more than ten seconds) for it.
#[tauri::command]
pub async fn startup_update(app: AppHandle, wait_ms: u64) -> Result<DesktopUpdate, String> {
    let st = shared(&app);
    let wait = Duration::from_millis(wait_ms).min(MAX_WAIT);
    let waiting = st.clone();
    tauri::async_runtime::spawn_blocking(move || waiting.wait(wait)).await.map_err(|e| e.to_string())?;
    let d = st.describe(&current_version(&app));
    println!("vyre-desktop: update: the page asked before the lock screen: {:?}{}", d.phase, d.version.as_deref().map(|v| format!(" {v}")).unwrap_or_default());
    Ok(d)
}

/// Check now. A network or feed failure comes back as words, never as "up to date".
#[tauri::command]
pub async fn check_desktop_update(app: AppHandle) -> Result<DesktopUpdate, String> {
    let st = shared(&app);
    let r = run_check(&app).await;
    st.record(&r);
    r.map(|_| st.describe(&current_version(&app)))
}

#[derive(Clone, Serialize)]
struct Progress { phase: &'static str, downloaded: u64, total: Option<u64>, turns: u32, chats: Vec<String>, left: Option<u64>, of: Option<u64> }

fn tell(app: &AppHandle, phase: &'static str, downloaded: u64, total: Option<u64>, turns: u32) {
    let _ = app.emit(PROGRESS_EVENT, Progress { phase, downloaded, total, turns, chats: Vec::new(), left: None, of: None });
}

/// While the update waits for replies: which chats they are in and how long the wait has left before the update goes on by itself.
fn tell_waiting(app: &AppHandle, turns: u32, chats: &[String], left: Duration, of: Duration) {
    let _ = app.emit(PROGRESS_EVENT, Progress { phase: "waiting", downloaded: 0, total: None, turns, chats: chats.iter().take(6).cloned().collect(), left: Some(left.as_secs()), of: Some(of.as_secs()) });
}

/// Words for a download that failed: a bad signature says so plainly.
fn refusal(e: &tauri_plugin_updater::Error) -> String {
    let text = e.to_string();
    let signature = matches!(e, tauri_plugin_updater::Error::Minisign(_)) || text.contains("signed for version") || text.to_lowercase().contains("signature");
    if signature { "The update was refused: its signature does not match Vyre's release key. Nothing was installed.".to_string() } else { format!("The update did not download: {text}") }
}

/// What the update needs free on the disk: the bundle is about 180 MB packed and about four times that unpacked, so ask for 1 GB.
const NEEDS_FREE: u64 = 1_000_000_000;

#[cfg(target_os = "macos")]
const NEEDS_SPACE: &str = "Your Mac needs about 1 GB free to update. Free some space and press Update now.";
#[cfg(not(target_os = "macos"))]
const NEEDS_SPACE: &str = "Your computer needs about 1 GB free to update. Free some space and press Update now.";

/// An error text that means the disk is full: the unpack stops with "No space left on device (os error 28)" (Windows: os error 112, "There is not enough space on the disk").
pub(crate) fn is_no_space(text: &str) -> bool {
    let t = text.to_lowercase();
    ["no space left", "os error 28", "os error 112", "enospc", "not enough space", "disk full", "needs about 1 gb free"].iter().any(|k| t.contains(k))
}

/// The words for a failed install: the space line when the disk is full, else the install's own text.
pub(crate) fn install_failure(e: &str) -> String {
    if is_no_space(e) { NEEDS_SPACE.to_string() } else { format!("The update did not install: {e}") }
}

/// The free kilobytes in `df -Pk PATH` output (the fourth column of its second line).
pub(crate) fn parse_df_free(out: &str) -> Option<u64> {
    let kb: u64 = out.lines().nth(1)?.split_whitespace().nth(3)?.parse().ok()?;
    Some(kb.saturating_mul(1024))
}

/// Free bytes on the volume that holds `path`; None when it cannot be told (Windows, or no `df`), which never blocks an update.
fn free_bytes(path: &std::path::Path) -> Option<u64> {
    if cfg!(windows) { return None; }
    let out = std::process::Command::new("df").arg("-Pk").arg(path).output().ok()?;
    if !out.status.success() { return None; }
    parse_df_free(&String::from_utf8_lossy(&out.stdout))
}

/// Before the download: the volumes the unpack uses (the temp folder and the one the app sits on) each have room. Err is the line to show.
pub(crate) fn space_check(free: &[Option<u64>]) -> Result<(), String> {
    if free.iter().flatten().any(|f| *f < NEEDS_FREE) { Err(NEEDS_SPACE.to_string()) } else { Ok(()) }
}

fn check_space() -> Result<(), String> {
    let app = std::env::current_exe().ok();
    let free = [free_bytes(&std::env::temp_dir()), app.as_deref().and_then(|p| p.parent()).and_then(free_bytes)];
    println!("vyre-desktop: update: free space {:?}", free);
    space_check(&free)
}

/// Something that runs on this computer and must be quiet before the app's files are replaced: each vyred daemon (sidecar.rs).
pub(crate) trait LocalService: Send + Sync {
    fn name(&self) -> &'static str;
    fn running(&self) -> bool;
    /// Hand over the turns that can go on on the server, and say how many still run here. None when the daemon cannot say (one from before this), which counts as none.
    fn drain(&self) -> Option<u32>;
    /// How many turns still run here.
    fn busy(&self) -> Option<u32>;
    /// The titles of the chats those turns are in. Empty when the daemon cannot say (one from before this).
    fn chats(&self) -> Vec<String> { Vec::new() }
    /// End every running turn cleanly (each chat keeps what it had written and says it was stopped). The turns still running after it, None when the daemon cannot (one from before this).
    fn stop_turns(&self) -> Option<u32> { None }
    /// Stop it and wait for its process to end; true when it ended on its own.
    fn stop(&self, timeout: Duration) -> bool;
    fn resume(&self);
}

/// Wait until no chat turn runs on this computer: first every running daemon hands over what can go on on the server, then the rest is waited for, at most `limit`. `on_wait` hears how many turns
/// run, which chats they are in and how long the wait has left. The wait ends early when `stop_now` says so ("Stop and update now"), and it ends when `limit` runs out: either way the turns still
/// running are told to stop, cleanly, and given `grace` to end; the update then goes on (a daemon that cannot end its turns is stopped anyway). Returns how many turns it ended this way.
pub(crate) fn wait_for_turns(services: &[Box<dyn LocalService>], limit: Duration, poll: Duration, grace: Duration, stop_now: &dyn Fn() -> bool, on_wait: &mut dyn FnMut(u32, &[String], Duration)) -> u32 {
    let begun = Instant::now();
    let mut turns: u32 = services.iter().filter(|s| s.running()).map(|s| s.drain().unwrap_or(0)).sum();
    while turns > 0 {
        let out_of_time = begun.elapsed() >= limit;
        if out_of_time || stop_now() {
            println!("vyre-desktop: update: {turns} turn(s) still running {}; ending them cleanly", if out_of_time { format!("after {}s", limit.as_secs()) } else { "and the person chose to update now".to_string() });
            let ended = turns;
            for s in services.iter().filter(|s| s.running() && s.busy().unwrap_or(0) > 0) { let _ = s.stop_turns(); }
            let waited = Instant::now();
            loop {
                let left: u32 = services.iter().filter(|s| s.running()).map(|s| s.busy().unwrap_or(0)).sum();
                if left == 0 || waited.elapsed() >= grace { if left > 0 { println!("vyre-desktop: update: {left} turn(s) did not end in {}s; the daemon is stopped anyway", grace.as_secs()); } break; }
                std::thread::sleep(poll);
            }
            return ended;
        }
        let chats: Vec<String> = services.iter().filter(|s| s.running()).flat_map(|s| s.chats()).collect();
        println!("vyre-desktop: update: waiting for {turns} turn(s) on this computer");
        on_wait(turns, &chats, limit.saturating_sub(begun.elapsed()));
        std::thread::sleep(poll);
        turns = services.iter().filter(|s| s.running()).map(|s| s.busy().unwrap_or(0)).sum();
    }
    0
}

/// Stop every running daemon and wait for each process to end. Returns the ones it stopped, to start again if the install fails.
pub(crate) fn stop_all(services: &[Box<dyn LocalService>], timeout: Duration) -> Vec<usize> {
    let mut stopped = Vec::new();
    for (i, s) in services.iter().enumerate() {
        if !s.running() { continue; }
        let clean = s.stop(timeout);
        println!("vyre-desktop: update: stopped {}{}", s.name(), if clean { "" } else { " (it did not end in time and was killed)" });
        stopped.push(i);
    }
    stopped
}

pub(crate) fn resume_all(services: &[Box<dyn LocalService>], stopped: &[usize]) {
    for i in stopped {
        if let Some(s) = services.get(*i) { println!("vyre-desktop: update: starting {} again", s.name()); s.resume(); }
    }
}

/// The steps between a verified download and the install, in order: wait for the turns (at most the cap, or until "Stop and update now"), end any still running, stop the daemons, install, and start
/// the daemons again if the install failed. It does not give up on a chat that runs: the wait is never open ended.
pub(crate) fn quiet_then_install(services: &[Box<dyn LocalService>], limits: (Duration, Duration, Duration, Duration), stop_now: &dyn Fn() -> bool, on_wait: &mut dyn FnMut(u32, &[String], Duration), on_stop: &mut dyn FnMut(u32), install: &mut dyn FnMut() -> Result<(), String>) -> Result<(), String> {
    let (turn_wait, poll, stop_wait, grace) = limits;
    let ended = wait_for_turns(services, turn_wait, poll, grace, stop_now, on_wait);
    on_stop(ended);
    let stopped = stop_all(services, stop_wait);
    match install() {
        Ok(()) => Ok(()),
        Err(e) => { resume_all(services, &stopped); Err(e) }
    }
}

struct Daemon { app: AppHandle, shared: crate::sidecar::Shared, name: &'static str }

/// `{"data":{"turns":n,...}}` from /local/daemon/busy or /drain.
pub(crate) fn parse_turns(body: &str) -> Option<u32> {
    let v: serde_json::Value = serde_json::from_str(body.trim()).ok()?;
    v.get("data")?.get("turns")?.as_u64().map(|n| n.min(u32::MAX as u64) as u32)
}

/// `{"data":{"chats":[{"id":..,"title":..}]}}` from /local/daemon/busy: the titles, the first few, a chat with no title as "a chat".
pub(crate) fn parse_chats(body: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(body.trim()) else { return Vec::new() };
    v.get("data").and_then(|d| d.get("chats")).and_then(|c| c.as_array()).map(|a| a.iter().take(6).map(|c| c.get("title").and_then(|t| t.as_str()).filter(|t| !t.trim().is_empty()).unwrap_or("a chat").to_string()).collect()).unwrap_or_default()
}

/// How long a daemon that is still starting is given to come up before the update asks it what runs and stops it.
const START_WAIT: Duration = Duration::from_secs(25);

/// Still starting: its process is up but it has not answered yet.
pub(crate) fn starting(phase: &crate::sidecar::Phase) -> bool {
    matches!(phase, crate::sidecar::Phase::Starting | crate::sidecar::Phase::Restarting)
}

impl Daemon {
    /// A daemon still starting is let come up first (a turn it recovers at start is then counted), so it is asked what runs and stops itself, closing its stores: the graceful stop needs the
    /// address and token it only has once it is ready. On Windows a download can finish before the daemon's Node has started (update-proof run 41633487747), and it was killed mid-start.
    fn settle(&self) {
        let begun = Instant::now();
        while begun.elapsed() < START_WAIT && crate::sidecar::is_running(&self.shared) && starting(&crate::sidecar::current(&self.shared).phase) {
            std::thread::sleep(Duration::from_millis(150));
        }
    }
}

impl LocalService for Daemon {
    fn name(&self) -> &'static str { self.name }
    fn running(&self) -> bool { crate::sidecar::is_running(&self.shared) }
    fn drain(&self) -> Option<u32> { self.settle(); crate::sidecar::local_json(&self.shared, "POST", "/local/daemon/drain").and_then(|b| parse_turns(&b)) }
    fn busy(&self) -> Option<u32> { crate::sidecar::local_json(&self.shared, "GET", "/local/daemon/busy").and_then(|b| parse_turns(&b)) }
    fn chats(&self) -> Vec<String> { crate::sidecar::local_json(&self.shared, "GET", "/local/daemon/busy").map(|b| parse_chats(&b)).unwrap_or_default() }
    fn stop_turns(&self) -> Option<u32> { crate::sidecar::local_json(&self.shared, "POST", "/local/daemon/stop-turns").and_then(|b| parse_turns(&b)) }
    fn stop(&self, timeout: Duration) -> bool { self.settle(); crate::sidecar::stop_and_wait(&self.shared, timeout) }
    fn resume(&self) { crate::sidecar::resume(&self.app, &self.shared) }
}

fn daemons(app: &AppHandle) -> Vec<Box<dyn LocalService>> {
    let state = app.state::<crate::commands::AppState>();
    vec![
        Box::new(Daemon { app: app.clone(), shared: state.sidecar.clone(), name: "the device service" }),
        Box::new(Daemon { app: app.clone(), shared: state.personal.clone(), name: "the Personal Space" }),
        Box::new(Daemon { app: app.clone(), shared: state.server.clone(), name: "the Space this Mac hosts" }),
    ]
}

/// "Stop and update now" on the Updating screen: the wait for running replies ends, they are stopped cleanly and the update goes on. Only while an install is running.
#[tauri::command]
pub fn update_stop_now(app: AppHandle) -> bool {
    let asked = shared(&app).request_stop_now();
    println!("vyre-desktop: update: the person chose to stop and update now ({})", if asked { "while an install runs" } else { "but no install is running" });
    asked
}

/// Download the newer Vyre, check its signature, make this computer quiet, install it and restart. Returns only if something failed.
#[tauri::command]
pub async fn install_desktop_update(app: AppHandle) -> Result<(), String> {
    let st = shared(&app);
    println!("vyre-desktop: update: the page asked to install");
    if !st.begin_install() { return Err("Vyre is already updating.".to_string()); }
    let r = install(&app, &st).await;
    st.end_install();
    if let Err(e) = &r { println!("vyre-desktop: update: not installed: {e}"); }
    r
}

async fn install(app: &AppHandle, st: &SharedUpdate) -> Result<(), String> {
    let mut update = match st.found() {
        Some(u) => u,
        None => {
            let r = run_check(app).await;
            st.record(&r);
            r?.ok_or_else(|| "Vyre is already up to date.".to_string())?
        }
    };
    // a full disk fails the unpack minutes in, with a path in the message: say so before the download
    check_space()?;
    // the check's short timeout is for the check; a download takes as long as it takes
    update.timeout = None;
    println!("vyre-desktop: update: downloading {} from {}", update.version, update.download_url);
    tell(app, "download", 0, None, 0);
    let (mut got, mut last) = (0u64, Instant::now().checked_sub(Duration::from_secs(1)).unwrap_or_else(Instant::now));
    let on_chunk = app.clone();
    let on_done = app.clone();
    let bytes = update
        .download(
            |chunk, total| {
                got += chunk as u64;
                if last.elapsed() >= Duration::from_millis(120) || Some(got) == total { last = Instant::now(); tell(&on_chunk, "download", got, total, 0); }
            },
            move || tell(&on_done, "verify", 0, None, 0),
        )
        .await
        .map_err(|e| { println!("vyre-desktop: update: refused: {e}"); refusal(&e) })?;
    println!("vyre-desktop: update: {} bytes, signature verified against the pinned release key", bytes.len());
    let services = daemons(app);
    let waiting = app.clone();
    let stopping = app.clone();
    let installing = app.clone();
    let asked = st.clone();
    tauri::async_runtime::spawn_blocking(move || {
        quiet_then_install(
            &services, (TURN_WAIT, Duration::from_secs(1), STOP_WAIT, STOP_TURNS_GRACE),
            &|| asked.stop_now_requested(),
            &mut |turns, chats, left| tell_waiting(&waiting, turns, chats, left, TURN_WAIT),
            &mut |ended| tell(&stopping, "stopping", 0, None, ended),
            &mut || {
                tell(&installing, "installing", 0, None, 0);
                println!("vyre-desktop: update: installing {}", update.version);
                // on Windows this starts the installer and ends the app; the installer opens the new Vyre when it is done
                update.install(&bytes).map_err(|e| install_failure(&e.to_string()))
            },
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    tell(app, "restarting", 0, None, 0);
    println!("vyre-desktop: update: installed, restarting");
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;
    use minisign_verify::{PublicKey, Signature};
    use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

    #[test]
    fn a_full_disk_gets_one_plain_line_and_other_failures_keep_their_words() {
        let unpack = "failed to unpack `Vyre.app/Contents/Resources/runtime/node_modules/es-toolkit/dist/set/keyBy.js` into `/private/var/folders/x`: No space left on device (os error 28)";
        assert_eq!(install_failure(unpack), NEEDS_SPACE);
        assert_eq!(install_failure("There is not enough space on the disk. (os error 112)"), NEEDS_SPACE);
        assert_eq!(install_failure("permission denied"), "The update did not install: permission denied");
        assert!(NEEDS_SPACE.ends_with("about 1 GB free to update. Free some space and press Update now."));
    }

    #[test]
    fn free_space_is_read_from_df_and_under_a_gigabyte_stops_the_update_before_the_download() {
        let df = "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s5 971350180 954000000 317000 100% /System/Volumes/Data\n";
        assert_eq!(parse_df_free(df), Some(317_000 * 1024));
        assert_eq!(parse_df_free("garbage"), None);
        assert_eq!(space_check(&[Some(317_000 * 1024), Some(50_000_000_000)]), Err(NEEDS_SPACE.to_string()));
        assert_eq!(space_check(&[Some(2_000_000_000), None]), Ok(()));
        assert_eq!(space_check(&[None, None]), Ok(()), "a volume that cannot be read never blocks an update");
    }

    #[test]
    fn a_prerelease_reads_beta_and_a_release_reads_stable() {
        assert_eq!(channel_of("1.0.0-rc.3"), "beta");
        assert_eq!(channel_of("1.0.0"), "stable");
        assert!(feed_url("beta").ends_with("/channel-beta/desktop-beta.json"));
        assert!(feed_url("stable").ends_with("/releases/latest/download/desktop-stable.json"));
        assert_eq!(feed_url("stable"), serde_json::from_str::<serde_json::Value>(include_str!("../tauri.conf.json")).unwrap()["plugins"]["updater"]["endpoints"][0], "the configured address is the stable feed");
    }

    #[test]
    fn only_a_feed_in_vyres_own_repository_overrides_the_channel() {
        let ok = "https://raw.githubusercontent.com/vyre-ai/vyre-v1/0123abcd/apps/desktop/src-tauri/ci/update-proof.json";
        assert_eq!(feed_override(Some(ok.into())).as_deref(), Some(ok));
        assert!(feed_override(Some("https://github.com/vyre-ai/vyre-v1/releases/download/v1.0.0/desktop-beta.json".into())).is_some());
        for bad in ["https://evil.example/feed.json", "http://raw.githubusercontent.com/vyre-ai/vyre-v1/x.json", "https://raw.githubusercontent.com/vyre-ai/vyre-v1/../../other/x.json", "https://raw.githubusercontent.com/vyre-ai/vyre-v1@evil.example/x", "https://raw.githubusercontent.com/someone/vyre-v1/x.json", ""] {
            assert!(feed_override(Some(bad.into())).is_none(), "{bad}");
        }
        assert!(feed_override(None).is_none());
    }

    #[test]
    fn the_startup_answer_is_checking_until_the_check_answers() {
        assert_eq!(phase_of(false, false, false), Phase::Checking);
        assert_eq!(phase_of(true, false, false), Phase::None);
        assert_eq!(phase_of(true, true, false), Phase::Failed, "offline is a failed check, never up to date");
        assert_eq!(phase_of(true, false, true), Phase::Available);
        let st = UpdateState::default();
        let begun = Instant::now();
        st.wait(Duration::from_millis(120));
        assert!(begun.elapsed() >= Duration::from_millis(100), "a check that has not answered is waited for, up to the limit");
        assert_eq!(st.describe("1.0.0-rc.16").phase, Phase::Checking);
        st.record(&Err("offline".into()));
        let d = st.describe("1.0.0-rc.16");
        assert_eq!((d.phase, d.channel.as_str(), d.version), (Phase::Failed, "beta", None));
        assert!(d.checked_at.is_some());
        let st = Arc::new(UpdateState::default());
        let later = st.clone();
        std::thread::spawn(move || { std::thread::sleep(Duration::from_millis(40)); later.record(&Ok(None)); });
        let begun = Instant::now();
        st.wait(Duration::from_secs(5));
        assert!(begun.elapsed() < Duration::from_secs(2), "the wait ends when the answer comes");
        assert_eq!(st.describe("1.0.0").phase, Phase::None);
        let off = UpdateState::default();
        off.record_off();
        assert_eq!(off.describe("1.0.0").phase, Phase::None);
        assert!(off.begin_install() && !off.begin_install(), "one install at a time");
        off.end_install();
        assert!(off.begin_install());
    }

    #[test]
    fn a_daemon_still_starting_is_waited_for_and_one_that_is_up_or_down_is_not() {
        use crate::sidecar::Phase;
        assert!(starting(&Phase::Starting) && starting(&Phase::Restarting));
        assert!(!starting(&Phase::Ready) && !starting(&Phase::Failed) && !starting(&Phase::Stopped));
    }

    #[test]
    fn the_daemon_answer_reads_as_a_count() {
        assert_eq!(parse_turns(r#"{"data":{"turns":2,"sources":[{"name":"engine","turns":2}]}}"#), Some(2));
        assert_eq!(parse_turns(r#"{"data":{"turns":0,"sources":[]}}"#), Some(0));
        assert_eq!(parse_turns(r#"{"error":{"code":"auth.unauthenticated"}}"#), None);
        assert_eq!(parse_turns("not json"), None);
    }

    /// A daemon on this computer, scripted: its turns, whether it can hand them over, and what it was asked.
    struct Fake { name: &'static str, up: Arc<AtomicUsize>, turns: Arc<AtomicU32>, handover: bool, log: Arc<Mutex<Vec<String>>>, titles: Vec<String>, stoppable: bool, stuck: bool }
    impl LocalService for Fake {
        fn name(&self) -> &'static str { self.name }
        fn running(&self) -> bool { self.up.load(Ordering::SeqCst) == 1 }
        fn drain(&self) -> Option<u32> {
            self.log.lock().unwrap().push(format!("drain {}", self.name));
            if self.handover { self.turns.store(0, Ordering::SeqCst); }
            Some(self.turns.load(Ordering::SeqCst))
        }
        fn busy(&self) -> Option<u32> {
            // a turn that cannot move finishes on its own after a while (a stuck one never does)
            let n = self.turns.load(Ordering::SeqCst);
            if n > 0 && !self.stuck { self.turns.store(n - 1, Ordering::SeqCst); }
            Some(self.turns.load(Ordering::SeqCst))
        }
        fn chats(&self) -> Vec<String> { self.titles.clone() }
        fn stop_turns(&self) -> Option<u32> {
            self.log.lock().unwrap().push(format!("stop turns {}", self.name));
            if !self.stoppable { return None; }
            self.turns.store(0, Ordering::SeqCst);
            Some(0)
        }
        fn stop(&self, _t: Duration) -> bool {
            if !self.stuck { assert_eq!(self.turns.load(Ordering::SeqCst), 0, "{} was stopped with a turn running", self.name); }
            self.log.lock().unwrap().push(format!("stop {}", self.name));
            self.up.store(0, Ordering::SeqCst);
            true
        }
        fn resume(&self) { self.log.lock().unwrap().push(format!("resume {}", self.name)); self.up.store(1, Ordering::SeqCst); }
    }
    fn fake(name: &'static str, up: bool, turns: u32, handover: bool, log: &Arc<Mutex<Vec<String>>>) -> Box<dyn LocalService> {
        Box::new(Fake { name, up: Arc::new(AtomicUsize::new(up as usize)), turns: Arc::new(AtomicU32::new(turns)), handover, log: log.clone(), titles: Vec::new(), stoppable: true, stuck: false })
    }
    /// A daemon whose turn never ends by itself: it names its chat, and can (or cannot) be told to stop it.
    fn stuck(name: &'static str, title: &str, stoppable: bool, log: &Arc<Mutex<Vec<String>>>) -> Box<dyn LocalService> {
        Box::new(Fake { name, up: Arc::new(AtomicUsize::new(1)), turns: Arc::new(AtomicU32::new(1)), handover: false, log: log.clone(), titles: vec![title.to_string()], stoppable, stuck: true })
    }
    const QUICK: (Duration, Duration, Duration, Duration) = (Duration::from_secs(5), Duration::from_millis(1), Duration::from_millis(10), Duration::from_millis(20));
    const NEVER: &dyn Fn() -> bool = &|| false;

    #[test]
    fn a_turn_that_can_move_is_handed_over_and_one_that_cannot_is_waited_for_before_anything_stops() {
        let log = Arc::new(Mutex::new(Vec::new()));
        // a person's Team Space turn on their computer (it goes on on the server) and a Personal Space turn (it can only run here)
        let services = vec![fake("links", true, 2, true, &log), fake("personal", true, 2, false, &log), fake("server", false, 0, false, &log)];
        let mut waits = Vec::new();
        let mut installed = 0;
        let r = quiet_then_install(&services, QUICK, NEVER, &mut |n, _c, _l| waits.push(n), &mut |_| log.lock().unwrap().push("stopping".into()), &mut || { installed += 1; log.lock().unwrap().push("install".into()); Ok(()) });
        assert!(r.is_ok());
        assert_eq!(waits, vec![2, 1], "it waited for the turn that stays here, and only that one");
        assert_eq!(installed, 1);
        assert_eq!(*log.lock().unwrap(), vec!["drain links", "drain personal", "stopping", "stop links", "stop personal", "install"], "handed over, waited, stopped, then installed; a daemon that was not running is left alone");
    }

    #[test]
    fn a_failed_install_starts_the_daemons_it_stopped_again() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let services = vec![fake("device", true, 0, false, &log), fake("personal", false, 0, false, &log)];
        let r = quiet_then_install(&services, QUICK, NEVER, &mut |_, _, _| {}, &mut |_| {}, &mut || Err("The update did not install: disk full".into()));
        assert_eq!(r.unwrap_err(), "The update did not install: disk full");
        assert_eq!(*log.lock().unwrap(), vec!["drain device", "stop device", "resume device"]);
        assert!(services[0].running(), "running again");
        assert!(!services[1].running(), "and one that was not running stays off");
    }

    #[test]
    fn a_reply_that_never_ends_does_not_hold_the_update_forever_at_the_cap_it_is_stopped_cleanly_and_the_update_goes_on() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let services: Vec<Box<dyn LocalService>> = vec![stuck("device", "Rivera intake", true, &log), fake("personal", true, 0, false, &log)];
        let mut seen: Vec<(u32, Vec<String>, Duration)> = Vec::new();
        let mut stopped_with = None;
        let mut installed = 0;
        let r = quiet_then_install(&services, (Duration::from_millis(40), Duration::from_millis(5), Duration::from_millis(10), Duration::from_millis(30)), NEVER,
            &mut |n, c, l| seen.push((n, c.to_vec(), l)), &mut |ended| stopped_with = Some(ended), &mut || { installed += 1; Ok(()) });
        assert!(r.is_ok(), "the cap ran out: the update went on");
        assert_eq!(installed, 1);
        assert_eq!(stopped_with, Some(1), "it says how many replies it ended");
        assert!(!seen.is_empty() && seen.iter().all(|(n, c, _)| *n == 1 && c == &vec!["Rivera intake".to_string()]), "while it waited it named the chat");
        assert!(seen.windows(2).all(|w| w[1].2 <= w[0].2), "the time left only goes down");
        assert!(seen.iter().all(|(_, _, l)| *l <= Duration::from_millis(40)), "and never more than the cap");
        let l = log.lock().unwrap().clone();
        let pos = |x: &str| l.iter().position(|e| e == x).unwrap_or(usize::MAX);
        assert!(pos("stop turns device") < pos("stop device"), "the turns were ended before the daemon was stopped: {l:?}");
        assert!(l.iter().filter(|e| e.starts_with("stop turns")).count() == 1 && !l.contains(&"stop turns personal".to_string()), "only a daemon that runs a turn is asked");
    }

    #[test]
    fn stop_and_update_now_ends_the_wait_at_once_and_ends_the_reply_cleanly() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let services: Vec<Box<dyn LocalService>> = vec![stuck("device", "Weekly update", true, &log)];
        let asked = std::sync::atomic::AtomicBool::new(false);
        let mut waits = 0;
        let begun = Instant::now();
        // the person presses the button while the shell is waiting: the next look sees it
        let r = quiet_then_install(&services, (Duration::from_secs(600), Duration::from_millis(5), Duration::from_millis(10), Duration::from_millis(30)), &|| asked.load(Ordering::SeqCst),
            &mut |_, _, _| { waits += 1; if waits == 3 { asked.store(true, Ordering::SeqCst); } }, &mut |_| {}, &mut || Ok(()));
        assert!(r.is_ok());
        assert_eq!(waits, 3, "it waited until the press, no longer");
        assert!(begun.elapsed() < Duration::from_secs(5), "and did not wait out the ten minute cap");
        assert!(log.lock().unwrap().contains(&"stop turns device".to_string()));
    }

    #[test]
    fn a_daemon_that_cannot_end_its_turns_is_stopped_anyway_after_the_grace_and_the_update_still_goes_on() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let services: Vec<Box<dyn LocalService>> = vec![stuck("old", "A chat", false, &log)];
        let mut installed = 0;
        let r = quiet_then_install(&services, (Duration::from_millis(10), Duration::from_millis(2), Duration::from_millis(10), Duration::from_millis(20)), NEVER, &mut |_, _, _| {}, &mut |_| {}, &mut || { installed += 1; Ok(()) });
        assert!(r.is_ok());
        assert_eq!(installed, 1);
        assert_eq!(*log.lock().unwrap(), vec!["drain old", "stop turns old", "stop old"], "asked to end it, then stopped as the update always does");
    }

    #[test]
    fn the_stop_now_request_counts_only_while_an_install_runs_and_starts_clear() {
        let st = UpdateState::default();
        assert!(!st.request_stop_now(), "nothing is installing: the press is ignored");
        assert!(st.begin_install());
        assert!(!st.stop_now_requested());
        assert!(st.request_stop_now() && st.stop_now_requested());
        st.end_install();
        assert!(st.begin_install());
        assert!(!st.stop_now_requested(), "a new install does not inherit an old press");
    }

    #[test]
    fn the_daemon_answer_names_the_chats() {
        assert_eq!(parse_chats(r#"{"data":{"turns":1,"sources":[],"chats":[{"id":"thr_1","title":"Rivera intake"},{"id":"thr_2","title":""}]}}"#), vec!["Rivera intake".to_string(), "a chat".to_string()]);
        assert!(parse_chats(r#"{"data":{"turns":0,"sources":[]}}"#).is_empty(), "a daemon from before this names none");
        assert!(parse_chats("not json").is_empty());
    }

    #[test]
    fn a_daemon_that_cannot_say_counts_as_quiet() {
        struct Old;
        impl LocalService for Old {
            fn name(&self) -> &'static str { "old" }
            fn running(&self) -> bool { true }
            fn drain(&self) -> Option<u32> { None }
            fn busy(&self) -> Option<u32> { None }
            fn stop(&self, _t: Duration) -> bool { true }
            fn resume(&self) {}
        }
        let services: Vec<Box<dyn LocalService>> = vec![Box::new(Old)];
        let mut n = 0;
        assert!(quiet_then_install(&services, QUICK, NEVER, &mut |_, _, _| {}, &mut |_| {}, &mut || { n += 1; Ok(()) }).is_ok());
        assert_eq!(n, 1);
    }

    #[test]
    fn the_pinned_key_in_the_config_is_one_tauris_verifier_reads() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let b64 = conf["plugins"]["updater"]["pubkey"].as_str().unwrap();
        // the base64 of the minisign public key file, the way the updater plugin decodes it
        let bytes: Vec<u8> = {
            const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
            let mut out = Vec::new();
            let (mut acc, mut bits) = (0u32, 0u32);
            for c in b64.bytes().filter(|c| *c != b'=') {
                acc = (acc << 6) | T.iter().position(|t| *t == c).expect("base64") as u32;
                bits += 6;
                if bits >= 8 { bits -= 8; out.push((acc >> bits) as u8); acc &= (1 << bits) - 1; }
            }
            out
        };
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.starts_with("untrusted comment: minisign public key: "));
        PublicKey::decode(&text).expect("the pinned updater key parses");
    }

    #[test]
    fn a_signature_made_by_the_release_script_verifies_with_tauris_own_checker_and_only_for_its_file() {
        let key = PublicKey::decode(include_str!("../fixtures/updater/key.pub")).unwrap();
        let sig = Signature::decode(include_str!("../fixtures/updater/bundle.minisig")).unwrap();
        let data = include_bytes!("../fixtures/updater/bundle.bin");
        key.verify(data, &sig, false).expect("the signature is good for the file it was made from");
        let mut other = data.to_vec();
        other[0] ^= 1;
        assert!(key.verify(&other, &sig, false).is_err(), "and for no other file: a bad signature is refused");
    }
}
