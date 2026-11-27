# The agent workspace (owner brainstorm 6 Nov, team/v1/DESIGN-agent-workspaces.md): a small container every agent and every person's Assistant works in. A shell, tmux, git, node, python and the usual
# command line tools; no screen, no Chrome. The terminal is tmux inside it (modules/terminal/workspace.ts runs `docker exec <container> tmux ...`), so an agent's commands and a person's attached
# Terminal tab are the same sessions. The container is created by modules/terminal (workspaceContainerConfig): all capabilities dropped, no new privileges, no Docker socket, a non-root user,
# /tmp a noexec tmpfs, the home on a named volume, the agent's Files folder and its projects' shared folders mounted under it.
#
#   docker build -t vyre/agent-workspace:1 images/agent-workspace
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205

# The label is how `vyre-server update` knows this image is Vyre's and may be pruned when no kept release names it.
LABEL ai.vyre.image="workspace"

# tmux: the sessions. git, curl, jq, ripgrep, less, nano, unzip, zip, openssh-client (git over ssh with a key the agent is given; no server): the daily tools. python3 with pip and venv: scripts.
# build-essential and pkg-config: native modules and small C builds. procps and coreutils: ps, du. No sudo, no su, no docker client, no package manager left to use at run time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tmux git curl jq ripgrep less nano unzip zip openssh-client acl python3 python3-pip python3-venv build-essential pkg-config procps coreutils locales \
 && sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/* \
 && rm -f /usr/bin/su /bin/su /usr/bin/passwd /usr/bin/chsh /usr/bin/chfn /usr/bin/newgrp /usr/bin/gpasswd /usr/bin/mount /usr/bin/umount

# The GitHub CLI (owner ruling, 27 Nov: whoami, git and gh work in the agent's terminal). A pinned release with its published checksum, not the apt repository: the build needs no key and no network
# after this step, and a changed file fails the build. Its login lives in ~/.config/gh in the agent's home volume, so it survives sleep and updates; the sign-in itself is the person's (a device code in the terminal).
ARG GH_VERSION=2.106.0
ARG GH_SHA256_AMD64=a476449fa9625413c54a3734eded62e9e480e49f421ff08e7f3b3879c059a033
ARG GH_SHA256_ARM64=5e8a0c51e1a8345f36bd0b8bb88604b6a5388df16f3ab3e3b9b6d794fa223a67
RUN set -eu; \
    case "$(uname -m)" in x86_64) a=amd64; sum="$GH_SHA256_AMD64";; aarch64) a=arm64; sum="$GH_SHA256_ARM64";; *) echo "no gh for $(uname -m)"; exit 1;; esac; \
    curl -fsSL -o /tmp/gh.tgz "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${a}.tar.gz"; \
    echo "${sum}  /tmp/gh.tgz" | sha256sum -c -; \
    tar -xzf /tmp/gh.tgz -C /tmp; \
    install -m 0755 "/tmp/gh_${GH_VERSION}_linux_${a}/bin/gh" /usr/local/bin/gh; \
    rm -rf /tmp/gh.tgz "/tmp/gh_${GH_VERSION}_linux_${a}"; \
    gh --version

# No setuid or setgid program is left (no-new-privileges stops them at run time; this removes them from the image).
RUN find / -xdev \( -perm -4000 -o -perm -2000 \) -type f -exec chmod a-s {} +

RUN groupadd --gid 10001 agent \
 && useradd --uid 10001 --gid 10001 --home-dir /home/agent --shell /bin/bash --create-home agent \
 && mkdir -p /home/agent/Vyre /home/agent/projects \
 && chown -R 10001:10001 /home/agent \
 && chmod 0700 /home/agent

# People who use a shared agent without owning it work as Unix users of their own (modules/terminal/asker.ts): uids 20000 to 20999, named u<uid>, each with a home /people/u<uid> that the person makes
# themselves (0700, so nobody else, the agent's own user 10001 included, can enter). The image makes every one of these folders for its own uid, 0700, and /people itself is 0711: nobody can list it or make or
# remove a folder in it, so nobody can make another person's folder first. /people is a volume of its own (a new volume is filled from the image on its first use);
# another's; no capability is needed anywhere. The agent's home /home/agent stays 0700 owned by 10001, which is what keeps these users out of it (and out of ~/Vyre and ~/projects under it).
RUN mkdir -p -m 0711 /people \
 && for i in $(seq 20000 20999); do echo "u$i:x:$i:$i:person $i:/people/u$i:/bin/bash" >> /etc/passwd; echo "u$i:x:$i:" >> /etc/group; mkdir -m 0700 /people/u$i; chown $i:$i /people/u$i; done

# The folders people other than the agent's owner may be let into live outside the agent's home, under /shared (the home is closed to them entirely): /shared/projects and /shared/chats can be passed through by
# anyone and listed by no one (0711), each project and chat folder below them opens by name; /shared/Vyre is the Files mirror, the agent's own and opened to a person by name.
RUN mkdir -p /shared/projects /shared/chats /shared/Vyre \
 && chown -R 10001:10001 /shared && chmod 0711 /shared /shared/projects /shared/chats && chmod 0700 /shared/Vyre

# The job supervisor (rc.44): the container's one program. It starts what the agent asked for as background jobs (~/.vyre/jobs), restarts a job that dies, keeps its log, and, because Docker restarts the container after a
# reboot, starts them all again. Owned by root and not writable by the agent: the agent changes jobs only through their folders. See supervisor.mjs.
COPY supervisor.mjs jobs-cli.mjs /opt/vyre/
RUN chmod 0644 /opt/vyre/supervisor.mjs /opt/vyre/jobs-cli.mjs

# One tmux config for every session: a big scrollback (the terminal tab reads it back), no status bar (the tab has its own chrome), no escape delay.
COPY tmux.conf /etc/tmux.conf

ENV HOME=/home/agent \
    LANG=en_US.UTF-8 \
    TERM=xterm-256color \
    NODE_ENV=development

USER 10001:10001
WORKDIR /home/agent
# Created with Init: true, so a process that dies is reaped by Docker's init. The supervisor keeps the container up and runs the agent's background jobs; every other command is a `docker exec`.
CMD ["node", "/opt/vyre/supervisor.mjs"]
