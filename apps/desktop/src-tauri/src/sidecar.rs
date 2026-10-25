// The vyred sidecar: the device-role daemon that runs beside the window (ARCH 5.10, 7.13).
// The shell starts it on a free loopback port, reads its "listening on <url>" line, waits for /healthz,
// restarts it if it dies (a few times a minute at most) and stops it when the app exits.
// The page never fetches the daemon from the webview origin; it asks the shell (commands.rs), so no CORS
// opening is needed on the daemon.

use serde::Serialize;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

pub const EVENT: &str = "vyre://sidecar";
const MAX_RESTARTS_PER_MINUTE: usize = 5;
const HEALTH_WAIT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Starting,
    Ready,
    Restarting,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub phase: Phase,
    pub url: Option<String>,
    pub version: Option<String>,
    pub restarts: usize,
    pub error: Option<String>,
}

impl Status {
    fn new(phase: Phase) -> Self {
        Status { phase, url: None, version: None, restarts: 0, error: None }
    }
}

#[derive(Default)]
pub struct Sidecar {
    pub status: Mutex<Option<Status>>,
    child: Mutex<Option<CommandChild>>,
    stopping: Mutex<bool>,
    starts: Mutex<Vec<Instant>>,
}

pub type Shared = Arc<Sidecar>;

/// `vyred 0.0.0 device - listening on http://127.0.0.1:41233` gives the URL.
pub fn parse_listening(line: &str) -> Option<String> {
    let at = line.find("listening on ")?;
    let url = line[at + "listening on ".len()..].trim();
    if url.starts_with("http://127.0.0.1:") || url.starts_with("http://localhost:") || url.starts_with("http://[::1]:") {
        Some(url.to_string())
    } else {
        None
    }
}

/// The version word out of the same line, `vyred <version> <roles> ...`.
pub fn parse_version(line: &str) -> Option<String> {
    let mut words = line.split_whitespace();
    if words.next()? != "vyred" {
        return None;
    }
    words.next().map(|s| s.to_string())
}

fn host_port(url: &str) -> Option<SocketAddr> {
    let rest = url.strip_prefix("http://")?;
    let hp = rest.split('/').next()?;
    let hp = hp.replace("localhost", "127.0.0.1");
    hp.parse().ok()
}

/// GET /healthz over a plain socket, no HTTP crate. True on any 200: the daemon answering is what the shell needs;
/// its own `ok` flag also reflects machine probes (disk encryption, clock) that the page shows, not a reason to restart it.
pub fn healthy(url: &str) -> bool {
    let addr = match host_port(url) {
        Some(a) => a,
        None => return false,
    };
    let mut s = match TcpStream::connect_timeout(&addr, Duration::from_millis(800)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = s.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = s.set_write_timeout(Some(Duration::from_millis(1500)));
    if s.write_all(format!("GET /healthz HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n").as_bytes()).is_err() {
        return false;
    }
    let mut text = String::new();
    let _ = s.read_to_string(&mut text);
    text.starts_with("HTTP/1.1 200")
}

/// Where the daemon's program lives: VYRE_RUNTIME_DIR (dev), else the bundled `runtime` resource.
fn runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("VYRE_RUNTIME_DIR") {
        return Ok(PathBuf::from(dir));
    }
    app.path().resource_dir().map(|d| d.join("runtime")).map_err(|e| e.to_string())
}

fn set(app: &AppHandle, shared: &Shared, status: Status) {
    if let Ok(mut s) = shared.status.lock() {
        *s = Some(status.clone());
    }
    let _ = app.emit(EVENT, status);
}

fn may_start(shared: &Shared) -> bool {
    let mut starts = match shared.starts.lock() {
        Ok(s) => s,
        Err(_) => return false,
    };
    let now = Instant::now();
    starts.retain(|t| now.duration_since(*t) < Duration::from_secs(60));
    if starts.len() >= MAX_RESTARTS_PER_MINUTE {
        return false;
    }
    starts.push(now);
    true
}

/// Start (or restart) the daemon. Returns at once; progress arrives as EVENT and through `current`.
pub fn start(app: &AppHandle, shared: &Shared, restarts: usize) {
    if !may_start(shared) {
        let mut st = Status::new(Phase::Failed);
        st.restarts = restarts;
        st.error = Some("the background service stopped five times in a minute".to_string());
        set(app, shared, st);
        return;
    }
    let mut st = Status::new(if restarts == 0 { Phase::Starting } else { Phase::Restarting });
    st.restarts = restarts;
    set(app, shared, st);

    let launched = (|| -> Result<_, String> {
        let runtime = runtime_dir(app)?;
        let entry = runtime.join("host").join("src").join("daemon").join("main.ts");
        let data = app.path().app_data_dir().map_err(|e| e.to_string())?.join("vyred");
        std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
        let args = vec![
            entry.to_string_lossy().to_string(),
            "--role".to_string(),
            "device".to_string(),
            "--data-dir".to_string(),
            data.to_string_lossy().to_string(),
            "--host".to_string(),
            "127.0.0.1".to_string(),
            "--port".to_string(),
            "0".to_string(),
        ];
        let cmd = app.shell().sidecar("vyred").map_err(|e| e.to_string())?.args(args).current_dir(runtime);
        cmd.spawn().map_err(|e| e.to_string())
    })();

    let (mut rx, child) = match launched {
        Ok(pair) => pair,
        Err(e) => {
            let mut st = Status::new(Phase::Failed);
            st.restarts = restarts;
            st.error = Some(e);
            set(app, shared, st);
            return;
        }
    };
    if let Ok(mut c) = shared.child.lock() {
        *c = Some(child);
    }

    let app2 = app.clone();
    let shared2 = shared.clone();
    tauri::async_runtime::spawn(async move {
        let mut url: Option<String> = None;
        let mut version: Option<String> = None;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let text = String::from_utf8_lossy(&bytes).to_string();
                    for line in text.lines() {
                        if let Some(u) = parse_listening(line) {
                            version = parse_version(line);
                            url = Some(u.clone());
                            let (a, s, v) = (app2.clone(), shared2.clone(), version.clone());
                            std::thread::spawn(move || wait_ready(&a, &s, u, v, restarts));
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!("vyred: {}", String::from_utf8_lossy(&bytes).trim_end());
                }
                CommandEvent::Error(e) => eprintln!("vyred error: {e}"),
                CommandEvent::Terminated(payload) => {
                    if let Ok(mut c) = shared2.child.lock() {
                        *c = None;
                    }
                    let stopping = shared2.stopping.lock().map(|s| *s).unwrap_or(true);
                    if stopping {
                        set(&app2, &shared2, Status::new(Phase::Stopped));
                    } else {
                        eprintln!("vyred ended with {:?} (url {:?}, version {:?}), restarting", payload.code, url, version);
                        std::thread::sleep(Duration::from_millis(800));
                        start(&app2, &shared2, restarts + 1);
                    }
                    break;
                }
                _ => {}
            }
        }
    });
}

fn wait_ready(app: &AppHandle, shared: &Shared, url: String, version: Option<String>, restarts: usize) {
    let begun = Instant::now();
    while begun.elapsed() < HEALTH_WAIT {
        if healthy(&url) {
            let mut st = Status::new(Phase::Ready);
            st.url = Some(url);
            st.version = version;
            st.restarts = restarts;
            println!("vyre-desktop: sidecar ready at {}", st.url.as_deref().unwrap_or("-"));
            set(app, shared, st);
            return;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    let mut st = Status::new(Phase::Failed);
    st.url = Some(url);
    st.restarts = restarts;
    st.error = Some("the background service did not answer in time".to_string());
    set(app, shared, st);
}

pub fn current(shared: &Shared) -> Status {
    shared.status.lock().ok().and_then(|s| s.clone()).unwrap_or_else(|| Status::new(Phase::Starting))
}

/// Stop the daemon for good (app exit). The restart loop sees `stopping` and lets it go.
pub fn stop(shared: &Shared) {
    if let Ok(mut s) = shared.stopping.lock() {
        *s = true;
    }
    if let Ok(mut c) = shared.child.lock() {
        if let Some(child) = c.take() {
            let _ = child.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listening_line_gives_the_loopback_url_and_version() {
        let line = "vyred 0.6.9 device - listening on http://127.0.0.1:41233";
        assert_eq!(parse_listening(line).as_deref(), Some("http://127.0.0.1:41233"));
        assert_eq!(parse_version(line).as_deref(), Some("0.6.9"));
    }

    #[test]
    fn a_non_loopback_address_is_not_trusted() {
        assert!(parse_listening("vyred 1 device - listening on http://10.0.0.5:8420").is_none());
        assert!(parse_listening("starting up").is_none());
        assert!(parse_version("noise 1 2").is_none());
    }

    #[test]
    fn host_port_reads_loopback_urls() {
        assert_eq!(host_port("http://127.0.0.1:8420").map(|a| a.port()), Some(8420));
        assert_eq!(host_port("http://localhost:9").map(|a| a.port()), Some(9));
        assert!(host_port("https://x").is_none());
    }

    #[test]
    fn nothing_listening_is_not_healthy() {
        assert!(!healthy("http://127.0.0.1:1"));
    }

    #[test]
    fn restarts_are_capped_per_minute() {
        let shared: Shared = Arc::new(Sidecar::default());
        for _ in 0..MAX_RESTARTS_PER_MINUTE {
            assert!(may_start(&shared));
        }
        assert!(!may_start(&shared));
    }
}
