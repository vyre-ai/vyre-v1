# The agent workspace (owner brainstorm 6 Nov, team/v1/DESIGN-agent-workspaces.md): a small container every agent and every person's Assistant works in. A shell, tmux, git, node, python and the usual
# command line tools; no screen, no Chrome. The terminal is tmux inside it (modules/terminal/workspace.ts runs `docker exec <container> tmux ...`), so an agent's commands and a person's attached
# Terminal tab are the same sessions. The container is created by modules/terminal (workspaceContainerConfig): all capabilities dropped, no new privileges, no Docker socket, a non-root user,
# /tmp a noexec tmpfs, the home on a named volume, the agent's Files folder and its projects' shared folders mounted under it.
#
#   docker build -t vyre/agent-workspace:1 images/agent-workspace
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205

# tmux: the sessions. git, curl, jq, ripgrep, less, nano, unzip, zip, openssh-client (git over ssh with a key the agent is given; no server): the daily tools. python3 with pip and venv: scripts.
# build-essential and pkg-config: native modules and small C builds. procps and coreutils: ps, du. No sudo, no su, no docker client, no package manager left to use at run time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tmux git curl jq ripgrep less nano unzip zip openssh-client python3 python3-pip python3-venv build-essential pkg-config procps coreutils locales \
 && sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/* \
 && rm -f /usr/bin/su /bin/su /usr/bin/passwd /usr/bin/chsh /usr/bin/chfn /usr/bin/newgrp /usr/bin/gpasswd /usr/bin/mount /usr/bin/umount

# No setuid or setgid program is left (no-new-privileges stops them at run time; this removes them from the image).
RUN find / -xdev \( -perm -4000 -o -perm -2000 \) -type f -exec chmod a-s {} +

RUN groupadd --gid 10001 agent \
 && useradd --uid 10001 --gid 10001 --home-dir /home/agent --shell /bin/bash --create-home agent \
 && mkdir -p /home/agent/Vyre /home/agent/projects \
 && chown -R 10001:10001 /home/agent \
 && chmod 0700 /home/agent

# One tmux config for every session: a big scrollback (the terminal tab reads it back), no status bar (the tab has its own chrome), no escape delay.
COPY tmux.conf /etc/tmux.conf

ENV HOME=/home/agent \
    LANG=en_US.UTF-8 \
    TERM=xterm-256color \
    NODE_ENV=development

USER 10001:10001
WORKDIR /home/agent
# Created with Init: true, so a process that dies is reaped by Docker's init. The container only has to stay up; every command is a `docker exec`.
CMD ["sleep", "infinity"]
