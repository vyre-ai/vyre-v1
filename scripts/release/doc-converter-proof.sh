#!/usr/bin/env bash
# The proof the Word converter image converts (release.yml, agent-images): a one-paragraph .docx goes in through the archive endpoint, the container runs with no network and no capabilities, the PDF comes
# out, and it starts with %PDF-. Run as: bash scripts/release/doc-converter-proof.sh <image>
set -euo pipefail
img="${1:?usage: doc-converter-proof.sh <image>}"
work="$(mktemp -d)"
trap 'rm -rf "$work"; [ -z "${cid:-}" ] || docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
mkdir -p "$work/docx/_rels" "$work/docx/word"
cat >"$work/docx/[Content_Types].xml" <<'X'
<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>
X
cat >"$work/docx/_rels/.rels" <<'X'
<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>
X
cat >"$work/docx/word/document.xml" <<'X'
<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Service agreement proof</w:t></w:r></w:p></w:body></w:document>
X
(cd "$work/docx" && zip -qr "$work/in.docx" .)
cid=$(docker create --network none --cap-drop ALL --security-opt no-new-privileges --memory 1g "$img")
docker cp "$work/in.docx" "$cid:/in/in.docx"
docker start -a "$cid" >/dev/null
docker cp "$cid:/out/in.pdf" "$work/out.pdf"
head -c 5 "$work/out.pdf" | grep -q '%PDF-' || { echo "the converter made no PDF"; exit 1; }
echo "converter proof ok: $(wc -c <"$work/out.pdf") bytes"
