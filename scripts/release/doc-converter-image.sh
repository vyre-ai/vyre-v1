#!/usr/bin/env bash
# The Word converter image for a release, reusing the last published one when its source has not changed (lane r42-docs). A LibreOffice build for linux/arm64 under qemu takes many minutes, and the image
# changes rarely, so each release must not rebuild it. The image is also published under a tag that names its source: src-<sha256 of images/doc-converter>. When that tag already exists in the registry its digest
# is the answer and nothing is built; otherwise the image is built, proven, pushed under the version and the source tag, and its new digest is the answer.
#   bash scripts/release/doc-converter-image.sh <version> <dryrun true|false>        prints  image=<ref>@sha256:<digest>  (nothing in a practice run, which builds and proves for this platform only)
# GITHUB_OUTPUT gets the same line when set. A lookup that fails for any reason means "build", never "reuse".
set -euo pipefail
version="${1:?version}"
dry="${2:-false}"
repo="ghcr.io/vyre-ai/doc-converter"
here="$(cd "$(dirname "$0")/../.." && pwd)"
src="$(cd "$here/images/doc-converter" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16)"
out() { if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "image=$1" >>"$GITHUB_OUTPUT"; fi; echo "image=$1"; }

if [ "$dry" != true ]; then
  # reuse: the digest the source tag already points at (the index digest, which each machine resolves to its own platform)
  if found="$(docker buildx imagetools inspect "$repo:src-$src" --format '{{json .Manifest}}' 2>/dev/null | jq -r '.digest // empty' 2>/dev/null)" && [[ "$found" == sha256:* ]]; then
    # the version tag follows it, so "doc-converter:<version>" still names what this release ships
    docker buildx imagetools create -t "$repo:$version" "$repo@$found" >/dev/null 2>&1 || true
    echo "doc-converter: source $src unchanged, reusing $found (no build)" >&2
    out "$repo@$found"
    exit 0
  fi
fi

img="$repo:$version"
docker build -t "$img" "$here/images/doc-converter"
# DOC_CONVERTER_PROOF=skip is for the script's own test, which has no image to prove
[ "${DOC_CONVERTER_PROOF:-}" = skip ] || bash "$here/scripts/release/doc-converter-proof.sh" "$img"
if [ "$dry" = true ]; then exit 0; fi
bash "$here/scripts/release/retry.sh" 2 30 docker buildx build --platform linux/amd64,linux/arm64 -t "$img" -t "$repo:src-$src" --push --metadata-file converter-image.json "$here/images/doc-converter"
digest="$(jq -r '."containerimage.digest"' converter-image.json)"
case "$digest" in sha256:*) ;; *) echo "no image digest in the build metadata" >&2; exit 1 ;; esac
out "$repo@$digest"
