# The Space browser (owner decision 6 Nov 2026, DESIGN-agent-workspaces.md): one container per Space host that holds a headless Chromium per agent profile and per person's Assistant profile, each in its own
# user-data-dir on the /data volume, so cookies and logins never cross. browserd is the one program (control socket for `ctl`, the live view and takeover, the idle stop). There is no Xvfb, no desktop, no ffmpeg:
# the live view is Chrome's own screencast over DevTools. It reuses agentd's DevTools driver (chrome.ts, cdp.ts, vault.ts, ws.ts) from the agent computer image.
#
# The build context is images/ (the two folders sit side by side so the imports resolve the same way in the repo and in the image):
#   docker build -f images/space-browser/Dockerfile -t vyre/space-browser:1 images
# Vyre for Chrome (apps/chrome) is baked in at /opt/vyre-chrome from images/agent-computer/vyre-chrome (scripts/release/computer.ts stageChrome copies it there first); without a manifest the browser runs without it.
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates chromium fonts-liberation fonts-noto-color-emoji procps coreutils \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/* \
 && rm -f /usr/bin/su /bin/su /usr/bin/passwd /usr/bin/chsh /usr/bin/chfn /usr/bin/newgrp /usr/bin/gpasswd /usr/bin/mount /usr/bin/umount

# No setuid or setgid program is left; Chromium runs sandboxed through user namespaces, which the container's seccomp profile allows. It never starts with --no-sandbox.
RUN find / -xdev \( -perm -4000 -o -perm -2000 \) -type f -exec chmod a-s {} +

RUN groupadd --gid 10001 browser \
 && useradd --uid 10001 --gid 10001 --home-dir /home/browser --shell /usr/sbin/nologin --create-home browser \
 && mkdir -p /data /opt/images/agent-computer/agentd /opt/images/space-browser/browserd \
 && chown -R 10001:10001 /home/browser /data \
 && chmod 0700 /home/browser

COPY agent-computer/agentd/ /opt/images/agent-computer/agentd/
COPY space-browser/browserd/ /opt/images/space-browser/browserd/
RUN ln -s /opt/images/space-browser/browserd /opt/browserd
COPY agent-computer/vyre-chrome/ /opt/vyre-chrome/
# An agent's browser never signs in to Google or syncs; Vyre for Chrome is pinned to the toolbar (the id comes from the path, as in the agent computer).
RUN mkdir -p /etc/chromium/policies/managed \
 && node -e 'const h=require("crypto").createHash("sha256").update("/opt/vyre-chrome").digest("hex").slice(0,32);const id=[...h].map((c)=>String.fromCharCode(97+parseInt(c,16))).join("");require("fs").writeFileSync("/etc/chromium/policies/managed/vyre.json",JSON.stringify({BrowserSignin:0,SyncDisabled:true,PromptForDownloadLocation:false,ExtensionSettings:{[id]:{toolbar_pin:"force_pinned"}}}))'
RUN chmod 0755 /opt/images/space-browser/browserd/ctl && chmod -R a+rX /opt/images /opt/vyre-chrome

ENV HOME=/home/browser \
    NODE_ENV=production \
    VYRE_BROWSER_ROOT=/data \
    VYRE_STREAM_PORT=7002

USER 10001:10001
WORKDIR /home/browser
VOLUME /data
EXPOSE 7002
# Created with Init: true, so a process that dies is reaped by Docker's init.
CMD ["node", "/opt/browserd/main.ts"]
