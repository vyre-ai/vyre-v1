import AppKit
import WebKit

// Ad-hoc mac shell for spike S12. Loads the same web build the Tauri shell points at
// (frontendDist ../web) and starts the vyred sidecar. Tauri itself is src-tauri;
// this bundle exists so the spike can sign and screenshot a running app without cargo or npm.
// Deep link scheme vyre is in Info.plist. The page shows the global shortcut the Tauri shell registers.

@MainActor
final class Delegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    let window: NSWindow
    let web: WKWebView
    let sidecar: Process
    let proofPath: String?
    var pageURL: URL?
    var finished = false
    var polls = 0
    var navTries = 0

    override init() {
        let proof = Delegate.arg("--proof")
        proofPath = proof
        let frame = NSRect(x: 80, y: 120, width: 960, height: 640)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Vyre"
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        web = WKWebView(frame: NSRect(origin: .zero, size: frame.size), configuration: config)
        web.autoresizingMask = [.width, .height]
        window.contentView = web
        sidecar = Process()
        super.init()
        web.navigationDelegate = self
    }

    static func arg(_ name: String) -> String? {
        let args = CommandLine.arguments
        guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
        return args[index + 1]
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        do {
            let port = try startSidecar()
            let page = URL(string: "http://127.0.0.1:\(port)/")!
            pageURL = page
            web.load(URLRequest(url: page))
        } catch {
            fail("sidecar did not start")
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self] in
            self?.finish(force: true)
        }
    }

    func startSidecar() throws -> Int {
        let resources = Bundle.main.resourceURL!
        let script = resources.appendingPathComponent("vyred")
        let webRoot = resources.appendingPathComponent("web")
        let portFile = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("vyred-port-\(getpid()).txt")
        try? FileManager.default.removeItem(at: portFile)
        sidecar.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        sidecar.arguments = [script.path]
        var env = ProcessInfo.processInfo.environment
        env["VYRE_SIDECAR_PORT"] = ProcessInfo.processInfo.environment["S12_PORT"] ?? "47211"
        env["VYRE_WEB"] = webRoot.path
        env["VYRE_PORT_FILE"] = portFile.path
        sidecar.environment = env
        sidecar.standardOutput = FileHandle.nullDevice
        sidecar.standardError = FileHandle.nullDevice
        try sidecar.run()
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            if let text = try? String(contentsOf: portFile, encoding: .utf8), let port = Int(text.trimmingCharacters(in: .whitespacesAndNewlines)), port > 0 {
                return port
            }
            Thread.sleep(forTimeInterval: 0.05)
        }
        throw NSError(domain: "s12", code: 1)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        poll()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        retryOrFail()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        retryOrFail()
    }

    func retryOrFail() {
        navTries += 1
        if navTries < 10, let pageURL {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.web.load(URLRequest(url: pageURL)) }
            return
        }
        fail("navigation failed")
    }

    func poll() {
        polls += 1
        web.evaluateJavaScript("document.documentElement.dataset.sidecar || ''") { [weak self] result, _ in
            Task { @MainActor in
                guard let self else { return }
                let text = result as? String ?? ""
                if text == "connected" || self.polls > 30 {
                    self.finish(force: text != "connected")
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.poll() }
                }
            }
        }
    }

    func finish(force: Bool) {
        if finished { return }
        finished = true
        capture()
        if sidecar.isRunning { sidecar.terminate() }
        let code: Int32 = force ? 1 : 0
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            NSApp.terminate(nil)
            exit(code)
        }
    }

    func fail(_ message: String) {
        FileHandle.standardError.write(Data(message.utf8))
        finish(force: true)
    }

    func capture() {
        guard let proofPath else { return }
        window.displayIfNeeded()
        let frame = window.contentView?.superview ?? web
        let data = snapshotView(frame) ?? snapshotView(web)
        if let data {
            try? data.write(to: URL(fileURLWithPath: proofPath))
        }
    }

    func snapshotView(_ view: NSView) -> Data? {
        let bounds = view.bounds
        guard bounds.width > 1, bounds.height > 1 else { return nil }
        guard let rep = view.bitmapImageRepForCachingDisplay(in: bounds) else { return nil }
        view.cacheDisplay(in: bounds, to: rep)
        return rep.representation(using: .png, properties: [:])
    }

    func applicationWillTerminate(_ notification: Notification) {
        if sidecar.isRunning { sidecar.terminate() }
    }
}

@main
enum Main {
    static func main() {
        let app = NSApplication.shared
        let delegate = Delegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}
