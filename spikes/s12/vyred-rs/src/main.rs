// vyred sidecar for the S12 desktop spike, std only so one source builds on mac and windows.
// Same /health body as binaries/vyred.py. A request such as /health?replica=wrote is appended
// to VYRE_STATE_FILE so CI can read what the webview reported.
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};

fn handle(mut s: TcpStream, state: &str) {
    let mut buf = [0u8; 4096];
    let n = s.read(&mut buf).unwrap_or(0);
    let req = String::from_utf8_lossy(&buf[..n]).to_string();
    let target = req.split_whitespace().nth(1).unwrap_or("/");
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p, q),
        None => (target, ""),
    };
    let (status, body) = if path == "/health" || path == "/v1/health" {
        if !query.is_empty() && !state.is_empty() {
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(state) {
                let _ = writeln!(f, "{}", query.replace('&', " "));
            }
        }
        ("200 OK", format!("{{\"ok\":true,\"name\":\"vyred\",\"pid\":{}}}", std::process::id()))
    } else {
        ("404 Not Found", "not found".to_string())
    };
    let head = format!(
        "HTTP/1.1 {}\r\ncontent-type: application/json; charset=utf-8\r\ncontent-length: {}\r\ncache-control: no-store\r\naccess-control-allow-origin: *\r\nconnection: close\r\n\r\n",
        status,
        body.len()
    );
    let _ = s.write_all(head.as_bytes());
    let _ = s.write_all(body.as_bytes());
}

fn main() {
    let port = std::env::var("VYRE_SIDECAR_PORT").unwrap_or_else(|_| "47211".to_string());
    let state = std::env::var("VYRE_STATE_FILE").unwrap_or_default();
    let listener = TcpListener::bind(format!("127.0.0.1:{}", port)).expect("bind");
    println!("LISTENING {}", port);
    for conn in listener.incoming().flatten() {
        let st = state.clone();
        std::thread::spawn(move || handle(conn, &st));
    }
}
