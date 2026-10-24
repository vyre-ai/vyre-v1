#!/usr/bin/env bash
# Probe: which browsers and drivers does the runner have?
for b in chromium chromium-browser google-chrome google-chrome-stable chrome firefox; do command -v $b && $b --version 2>&1 | head -1; done
ls ~/.cache/ms-playwright ~/.cache/puppeteer 2>&1 | head; node -v; npm -v; npm view playwright-core version 2>&1 | tail -1; df -h . | tail -1; id -un
