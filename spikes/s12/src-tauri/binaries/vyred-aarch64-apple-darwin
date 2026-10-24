#!/usr/bin/env python3
# vyred sidecar (spike S12). Loopback only. Same health body as spikes/s12/sidecar.ts.
# VYRE_SIDECAR_PORT selects the port (0 picks one). VYRE_WEB serves the web build at /.
# VYRE_PORT_FILE receives the chosen port so the shell can open it.

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

WEB = os.environ.get("VYRE_WEB", "")
PORT_FILE = os.environ.get("VYRE_PORT_FILE", "")


class Server(ThreadingHTTPServer):
    allow_reuse_address = True


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/health", "/v1/health"):
            body = json.dumps({"ok": True, "name": "vyred", "pid": os.getpid()}).encode("utf-8")
            self._send(200, "application/json; charset=utf-8", body)
            return
        if WEB and path in ("/", "/index.html"):
            file = os.path.join(os.path.realpath(WEB), "index.html")
            root = os.path.realpath(WEB)
            if file == os.path.join(root, "index.html") and os.path.isfile(file):
                with open(file, "rb") as fh:
                    self._send(200, "text/html; charset=utf-8", fh.read())
                return
        self._send(404, "text/plain; charset=utf-8", b"not found")

    def _send(self, status, content_type, body):
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.send_header("access-control-allow-origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return


def main():
    port = int(os.environ.get("VYRE_SIDECAR_PORT", "47211"))
    server = Server(("127.0.0.1", port), Handler)
    chosen = server.server_address[1]
    if PORT_FILE:
        with open(PORT_FILE, "w", encoding="utf-8") as fh:
            fh.write(str(chosen))
    print(f"LISTENING {chosen}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
