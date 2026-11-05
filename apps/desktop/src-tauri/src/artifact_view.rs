// The artifact viewer in the Mac and Windows app (owner ruling, 4 Nov: the viewer was blank). An artifact is served from a host of its own and trusts a cookie of that host. The app's page is
// tauri://localhost, which is cross-site to every Space, so WebKit never keeps that cookie inside a frame (proven on the macOS runner: test/artifact-frame.browser.test.ts). Here the artifact is
// opened as a child webview of the window: a top-level navigation to the host's one-time address, so the cookie is first-party and nothing depends on a third-party cookie. The page tells the shell
// where the viewer's frame is (a rectangle in the window), and the shell places the webview over it. The webview is given no commands and may only stay on the host it was opened on.
use std::sync::Mutex;
use tauri::webview::WebviewBuilder;
use tauri::{LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl, Window};

pub const VIEW: &str = "artifact-view";
/// The address the child webview shows now; a one-time code is never loaded twice, so the same address is moved, not reloaded.
static SHOWING: Mutex<Option<String>> = Mutex::new(None);

/// The only addresses the viewer opens: the artifact host's one-time code, https://<host>/x/<code>, or http://a.localhost:<port>/x/<code> for a Space on this computer. No credentials in the
/// address, no other path, no IP address or other loopback name.
pub fn artifact_url_ok(url: &str) -> bool {
    if url.len() > 512 || url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return false;
    }
    let (secure, rest) = match (url.strip_prefix("https://"), url.strip_prefix("http://")) {
        (Some(r), _) => (true, r),
        (None, Some(r)) => (false, r),
        _ => return false,
    };
    let (authority, path) = match rest.split_once('/') {
        Some((a, p)) => (a, p),
        None => return false,
    };
    if authority.is_empty() || authority.contains('@') {
        return false;
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) => (h, Some(p)),
        None => (authority, None),
    };
    if let Some(p) = port {
        if p.is_empty() || p.len() > 5 || !p.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
    }
    let host_ok = !host.is_empty()
        && host.len() <= 253
        && host.split('.').all(|l| !l.is_empty() && l.len() <= 63 && l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') && !l.starts_with('-') && !l.ends_with('-'))
        && host.contains('.')
        && !host.bytes().all(|b| b.is_ascii_digit() || b == b'.');
    if !host_ok {
        return false;
    }
    // plain http is for a.localhost alone (browsers send *.localhost to loopback)
    if !secure && !host.eq_ignore_ascii_case("a.localhost") {
        return false;
    }
    let code = path.split(['?', '#']).next().unwrap_or("");
    let code = match code.strip_prefix("x/") {
        Some(c) => c,
        None => return false,
    };
    (4..=64).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// The origin the child webview may stay on: scheme, host and port.
pub fn same_origin(a: &tauri::Url, b: &tauri::Url) -> bool {
    a.scheme() == b.scheme() && a.host_str() == b.host_str() && a.port_or_known_default() == b.port_or_known_default()
}

/// A rectangle from the page: finite and inside sane bounds, in logical pixels.
pub fn rect_ok(x: f64, y: f64, w: f64, h: f64) -> bool {
    [x, y, w, h].iter().all(|v| v.is_finite()) && (0.0..=20_000.0).contains(&x) && (0.0..=20_000.0).contains(&y) && (1.0..=20_000.0).contains(&w) && (1.0..=20_000.0).contains(&h)
}

fn view_of(window: &Window) -> Option<Webview> {
    window.app_handle().get_webview(VIEW)
}

/// Open the artifact in a child webview over the viewer's frame, or move the one that is open when the address is the same. A different address replaces it.
// async: on Windows a webview created inside a synchronous command waits for the main thread it is running on (the page's call never returned and the app did not quit)
#[tauri::command]
pub async fn artifact_view_show(window: Window, url: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if !artifact_url_ok(&url) {
        return Err("That address can't be opened in the viewer.".to_string());
    }
    if !rect_ok(x, y, width, height) {
        return Err("That frame is not on the screen.".to_string());
    }
    let parsed: tauri::Url = url.parse().map_err(|_| "That address can't be opened in the viewer.".to_string())?;
    let same = SHOWING.lock().map_err(|_| "The viewer is busy.".to_string())?.as_deref() == Some(url.as_str());
    if let Some(view) = view_of(&window) {
        if same {
            view.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
            view.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
            return Ok(());
        }
        let _ = view.close();
    }
    let home = parsed.clone();
    // the page may stay on its own host (the code redirects to the artifact's clean address there) and nowhere else
    let builder = WebviewBuilder::new(VIEW, WebviewUrl::External(parsed))
        .on_navigation(move |to| { let ok = same_origin(to, &home); eprintln!("vyre-desktop: artifactview navigation {} -> {}", to.host_str().unwrap_or(""), if ok { "allowed" } else { "refused" }); ok })
        .on_page_load(|_, p| eprintln!("vyre-desktop: artifactview page {:?} {}", p.event(), p.url().host_str().unwrap_or("")));
    window.add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    *SHOWING.lock().map_err(|_| "The viewer is busy.".to_string())? = Some(url);
    Ok(())
}

/// The frame moved or changed size (the window resized, the page scrolled, a sidebar opened).
#[tauri::command]
pub async fn artifact_view_bounds(window: Window, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if !rect_ok(x, y, width, height) {
        return Err("That frame is not on the screen.".to_string());
    }
    if let Some(view) = view_of(&window) {
        view.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        view.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The viewer closed, or a menu or sheet needs the space the webview covers (a native view draws above the page).
#[tauri::command]
pub async fn artifact_view_hide(window: Window) -> Result<(), String> {
    if let Some(view) = view_of(&window) {
        view.close().map_err(|e| e.to_string())?;
    }
    if let Ok(mut s) = SHOWING.lock() {
        *s = None;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_hosts_one_time_address_opens() {
        let code = "a".repeat(48);
        assert!(artifact_url_ok(&format!("https://harbor-a.vyre.run/x/{code}")));
        assert!(artifact_url_ok(&format!("https://a.team.example.com/x/{code}?embed=1")));
        assert!(artifact_url_ok(&format!("http://a.localhost:4100/x/{code}")));
        assert!(artifact_url_ok("https://harbor-a.vyre.run:8443/x/proof1"));
        // not the artifact's own path, a token address, other schemes, plain http anywhere but a.localhost, IP addresses, credentials, odd hosts
        for bad in [
            "https://harbor-a.vyre.run/sit_abc/",
            "https://harbor-a.vyre.run/a/sit_abc/k/aaaa/",
            "https://harbor-a.vyre.run/x/",
            "https://harbor-a.vyre.run/x/ab",
            "https://harbor-a.vyre.run/x/aa/../bb",
            "http://harbor-a.vyre.run/x/aaaaaaaa",
            "http://localhost:4100/x/aaaaaaaa",
            "http://127.0.0.1:4100/x/aaaaaaaa",
            "https://127.0.0.1/x/aaaaaaaa",
            "https://user@harbor-a.vyre.run/x/aaaaaaaa",
            "https://harbor-a.vyre.run:/x/aaaaaaaa",
            "https://harbor-a.vyre.run:99999x/x/aaaaaaaa",
            "https://-bad.vyre.run/x/aaaaaaaa",
            "https://nodot/x/aaaaaaaa",
            "file:///x/aaaaaaaa",
            "javascript:alert(1)",
            "tauri://localhost/x/aaaaaaaa",
            "https://harbor-a.vyre.run/x/aaaa aaaa",
        ] {
            assert!(!artifact_url_ok(bad), "{bad}");
        }
        assert!(!artifact_url_ok(&format!("https://harbor-a.vyre.run/x/{}", "a".repeat(65))));
    }

    #[test]
    fn the_webview_stays_on_its_origin() {
        let home: tauri::Url = "https://harbor-a.vyre.run/x/aaaa".parse().unwrap();
        assert!(same_origin(&"https://harbor-a.vyre.run/sit_1/".parse().unwrap(), &home));
        assert!(!same_origin(&"https://harbor.vyre.run/".parse().unwrap(), &home));
        assert!(!same_origin(&"http://harbor-a.vyre.run/".parse().unwrap(), &home));
        assert!(!same_origin(&"https://harbor-a.vyre.run:8443/".parse().unwrap(), &home));
    }

    #[test]
    fn a_frame_is_a_real_rectangle() {
        assert!(rect_ok(0.0, 56.0, 800.0, 600.0));
        assert!(!rect_ok(f64::NAN, 0.0, 10.0, 10.0));
        assert!(!rect_ok(-1.0, 0.0, 10.0, 10.0));
        assert!(!rect_ok(0.0, 0.0, 0.0, 10.0));
        assert!(!rect_ok(0.0, 0.0, 10.0, 1e9));
    }
}
