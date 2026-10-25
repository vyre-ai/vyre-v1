# The person's sandbox (S8, ARCH 6.6): where a CLI engine (Claude Code, Codex, Grok) runs for one person on the Space host.
# What makes it safe is not in this file: the container is created by sandbox/src/docker.ts with a read-only root, a tmpfs home, all capabilities dropped, no-new-privileges, an internal
# network whose only neighbour is the egress proxy, and nothing but the person's folders bound in. This file only has to be small, non-root and free of ways around that.
#
#   docker build -t vyre/person-sandbox:1 \
#     --build-arg ENGINE_PACKAGES="@anthropic-ai/claude-code@<pinned> @openai/codex@<pinned> <grok cli package>@<pinned>" images/person-sandbox
FROM node:24-bookworm-slim

# Space-separated npm packages, each name@exact-version. A build with an unpinned engine is refused: an engine that changes under a person between two chats is not what they signed in to.
ARG ENGINE_PACKAGES
RUN test -n "$ENGINE_PACKAGES" && for p in $ENGINE_PACKAGES; do case "$p" in *@[0-9]*) ;; *) echo "not pinned: $p" >&2; exit 1;; esac; done

# Tools the engines expect, and `timeout`, `shred` and `curl` which the sandbox's own exec, wipe and self-test use. No sudo, no ssh client, no docker client.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates coreutils curl git jq procps ripgrep \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/* \
 && rm -f /usr/bin/su /bin/su /usr/bin/passwd /usr/bin/chsh /usr/bin/chfn /usr/bin/newgrp /usr/bin/gpasswd /usr/bin/mount /usr/bin/umount

# No setuid or setgid program is left (no-new-privileges stops them at run time; this removes them from the image).
RUN find / -xdev \( -perm -4000 -o -perm -2000 \) -type f -exec chmod a-s {} +

RUN npm install --global --omit=dev --no-fund --no-audit $ENGINE_PACKAGES \
 && npm cache clean --force

# One user, with no shell login and no password. The uid matches sandbox/src/docker.ts (10001); the home is a tmpfs mounted over this empty folder at run time.
RUN groupadd --gid 10001 agent \
 && useradd --uid 10001 --gid 10001 --home-dir /home/agent --shell /usr/sbin/nologin --no-create-home agent \
 && mkdir -p /home/agent /work /run/vyre-creds \
 && chown 10001:10001 /home/agent /work /run/vyre-creds \
 && chmod 0700 /home/agent /run/vyre-creds

ENV HOME=/home/agent \
    NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    CLAUDE_CODE_DISABLE_AUTOUPDATE=1 \
    DISABLE_AUTOUPDATER=1

USER 10001:10001
WORKDIR /work
# The sandbox keeps the container up and runs engines with docker exec.
CMD ["sleep", "infinity"]
