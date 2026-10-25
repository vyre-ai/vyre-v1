# The agent computer (spec 2.7, ARCH 6.6, S9): a desktop an agent uses and a person can take over. Xvfb is the screen, Chromium is the browser, agentd is the one program that runs them, answers
# the control protocol of modules/computers (docker exec /opt/agentd/ctl <action> '<json>') and serves the live view. The container is created by modules/computers (computerContainerConfig): all
# capabilities dropped, no new privileges, /tmp and /dev/shm are noexec tmpfs, the profile is a named volume at /home/agent/.profile-disk and the agent's Files folder is bound at /home/agent/Vyre.
#
#   docker build -t vyre/agent-computer:1 images/agent-computer
#
# Vyre for Chrome (apps/chrome) is added by the release build, which has the whole repository as its context: it copies the built extension to /opt/vyre-chrome, and agentd loads it from there when
# it exists. The extension is not part of this build context.
FROM node:24-bookworm-slim

# chromium: the browser. xvfb: the screen. ffmpeg: frames for the live view and the recording. python3-xlib: the input injector (XTEST, with a round trip so an input is acknowledged once the server
# has it). fonts: pages must render. procps and coreutils: ps, du. No sudo, no ssh, no docker client, no package manager left to use at run time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates chromium xvfb ffmpeg python3 python3-xlib fonts-liberation fonts-noto-color-emoji procps coreutils \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/* \
 && rm -f /usr/bin/su /bin/su /usr/bin/passwd /usr/bin/chsh /usr/bin/chfn /usr/bin/newgrp /usr/bin/gpasswd /usr/bin/mount /usr/bin/umount

# No setuid or setgid program is left (no-new-privileges stops them at run time; this removes them from the image). Chromium's own sandbox helper is one of them: the container is the sandbox
# (agentd starts Chromium with --no-sandbox), so it goes too.
RUN find / -xdev \( -perm -4000 -o -perm -2000 \) -type f -exec chmod a-s {} +

RUN groupadd --gid 10001 agent \
 && useradd --uid 10001 --gid 10001 --home-dir /home/agent --shell /usr/sbin/nologin --create-home agent \
 && mkdir -p /home/agent/.profile-disk /home/agent/Vyre /opt/agentd \
 && chown -R 10001:10001 /home/agent \
 && chmod 0700 /home/agent

COPY agentd/ /opt/agentd/
RUN chmod 0755 /opt/agentd/ctl && chmod 0644 /opt/agentd/*.ts /opt/agentd/*.py /opt/agentd/package.json

ENV HOME=/home/agent \
    DISPLAY=:99 \
    NODE_ENV=production \
    VYRE_SCREEN=1280x800 \
    VYRE_STREAM_PORT=7001 \
    VYRE_STREAM_FPS=10

USER 10001:10001
WORKDIR /home/agent
EXPOSE 7001
# The container is created with Init: true, so a process that dies is reaped by Docker's init.
CMD ["node", "/opt/agentd/main.ts"]
