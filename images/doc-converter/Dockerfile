# The Word to PDF converter (lane r42-docs, 19 Nov 2026). LibreOffice with no desktop, run one conversion at a time by the documents seam (host/src/seams/doc-converter.ts): the .docx is copied in to /in,
# the container runs with no network, a read-only root, a tmpfs for its home, no capabilities and a memory limit, and the PDF is copied out of /out. It is fetched the first time a Word file is turned into a
# PDF (the way agent images are), and never baked into vyred.
#   docker build -f images/doc-converter/Dockerfile -t vyre/doc-converter:1 images/doc-converter
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libreoffice-writer-nogui fonts-liberation fonts-dejavu-core fonts-noto-core \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/* \
 && find / -xdev \( -perm -4000 -o -perm -2000 \) -type f -exec chmod a-s {} +

RUN groupadd --gid 10002 convert \
 && useradd --uid 10002 --gid 10002 --home-dir /home/convert --shell /usr/sbin/nologin --create-home convert \
 && mkdir -p /in /out \
 && chown 10002:10002 /in /out
USER 10002:10002
WORKDIR /out
# in.docx is put in /in; the PDF is /out/in.pdf. The command is fixed here, so the host only starts the container.
ENTRYPOINT ["soffice", "-env:UserInstallation=file:///tmp/profile", "--headless", "--norestore", "--convert-to", "pdf", "--outdir", "/out", "/in/in.docx"]
