#!/usr/bin/env bash
# Builds the Space browser image for a CI job or a box run: bash scripts/ci/build-space-browser.sh <tag>
# The image's build context is images/ (agent-computer and space-browser side by side) with two things staged in, because the runners have no buildx: Vyre for Chrome (apps/chrome, no build step) and
# the bridge protocol module as a real file (images/space-browser/browserd/vendor/chrome-bridge.ts is a link into lib/ in the repository). The same staging the heavy tests do for themselves.
set -euo pipefail
tag="${1:?usage: build-space-browser.sh <image tag>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
ctx="$(mktemp -d)"
trap 'rm -rf "$ctx"' EXIT
cp -r "$root/images/agent-computer" "$ctx/agent-computer"
cp -r "$root/images/space-browser" "$ctx/space-browser"
rm -f "$ctx/space-browser/browserd/vendor/chrome-bridge.ts"
cp "$root/lib/chrome-bridge.ts" "$ctx/space-browser/browserd/vendor/chrome-bridge.ts"
cp -r "$root/apps/chrome" "$ctx/agent-computer/vyre-chrome"
rm -rf "$ctx/agent-computer/vyre-chrome/tests" "$ctx/agent-computer/vyre-chrome/node_modules"
docker build -q ${DOCKER_BUILD_FLAGS:-} -f "$ctx/space-browser/Dockerfile" -t "$tag" "$ctx"
