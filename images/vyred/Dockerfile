# The vyred image: the Vyre daemon (host/src/daemon/main.ts) for the server and device roles (ARCH 7.13, spec 3.13). One image, the role comes from VYRE_ROLE.
# Build from the repo root: docker buildx bake -f images/vyred/docker-bake.hcl   (linux/amd64 and linux/arm64)
# The base is pinned by digest (the multi-arch index of node:24-bookworm-slim). Bump the pin on purpose, with the tag it was taken from in this comment.
# node:24-bookworm-slim, taken 25 Oct 2026.
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205

LABEL org.opencontainers.image.title="vyred" \
      org.opencontainers.image.source="https://github.com/vyre-ai/vyre" \
      org.opencontainers.image.licenses="MIT"

# git for project checkouts, tmux for terminals, tini as PID 1 (it reaps children and keeps tmux sessions alive across a vyred restart), bubblewrap for the sandbox a CLI engine runs in
# on a computer that joined a Space (--role compute).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git tmux tini bubblewrap \
 && rm -rf /var/lib/apt/lists/*

# The node image ships uid 1000 as `node`. vyred runs as that user and owns /data.
RUN install -d -o node -g node -m 0700 /data \
 && install -d -o node -g node -m 0755 /work

WORKDIR /opt/vyre
COPY --chown=node:node . /opt/vyre
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts \
 && npm cache clean --force

# The CLI engines a pinned chat runs with on a computer that joined a Space: Claude Code and Codex, each at an exact version (an engine that changes under a person between two chats is not what
# they signed in to). Bump the pins on purpose; a build with an unpinned package is refused. They run only inside bubblewrap (modules/engine/node-cli.ts), with the person's own sign-in filled in
# for the length of a turn.
ARG ENGINE_PACKAGES="@anthropic-ai/claude-code@2.1.316 @openai/codex@0.166.0"
RUN for p in $ENGINE_PACKAGES; do case "$p" in *@[0-9]*) ;; *) echo "not pinned: $p" >&2; exit 1;; esac; done \
 && npm install --global --omit=dev --no-fund --no-audit $ENGINE_PACKAGES \
 && npm cache clean --force

ENV CLAUDE_CODE_DISABLE_AUTOUPDATE=1 \
    DISABLE_AUTOUPDATER=1 \
    VYRE_DATA_DIR=/data \
    VYRE_ROLE=space \
    VYRE_HOST=0.0.0.0 \
    VYRE_PORT=8420 \
    VYRE_PROGRAM=vyre-server

USER node
VOLUME ["/data"]
EXPOSE 8420

# vyre-server doctor decides (images/vyred/healthcheck.mjs). The start period covers the first boot, which creates the Space.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 CMD ["node", "/opt/vyre/images/vyred/healthcheck.mjs"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/opt/vyre/host/src/daemon/main.ts"]
