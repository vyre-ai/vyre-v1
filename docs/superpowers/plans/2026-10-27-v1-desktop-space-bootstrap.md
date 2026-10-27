# V1 Desktop Space Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the packaged Tauri app open the real v1 Connect/Sign-in/Join flow against a verified Space instead of `tauri://localhost`.

**Architecture:** Extend the existing narrow Tauri bridge with typed bootstrap/deep-link data. The React app owns navigation and v1 capability calls; native code validates and delivers only Vyre deep links and never exposes the sidecar admin token.

**Tech Stack:** Tauri 2, Rust, TypeScript, React Native Web, v1 capability client, Node and Cargo tests.

---

### Task 1: Expose typed desktop bootstrap and deep-link events

**Files:**
- Modify: `apps/desktop/src/bridge.ts`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Test: `apps/desktop/tests/native.test.ts`
- Test: `apps/desktop/src-tauri/src/links.rs`

- [ ] **Step 1: Write failing bridge tests**

Assert `bootstrap()` invokes `desktop_info` and `take_pending_link`, returns typed sidecar/link data, and `listenLinks()` subscribes only to `vyre://deep-link` while returning its unlisten function.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node scripts/test-run.mjs --files apps/desktop/tests/native.test.ts`

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml links`

Expected: TypeScript FAIL because the bridge methods are absent; Rust link tests remain green.

- [ ] **Step 3: Implement the narrow bridge**

Add `DesktopInfo`, `DesktopDeepLink`, `bootstrap`, and `listenLinks` types/methods. Keep Rust deep-link validation bounded and redact parameters from logs. Do not expose arbitrary invoke, filesystem, shell, or network operations through the returned `Bridge`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node scripts/test-run.mjs --files apps/desktop/tests/native.test.ts`

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/bridge.ts apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/tests/native.test.ts apps/desktop/src-tauri/src/links.rs changelog.md
git commit -m "feat: expose desktop auth bootstrap and deep links"
```

### Task 2: Consume desktop bootstrap in SessionGate

**Files:**
- Create: `apps/app/src/shell/session/desktop.ts`
- Modify: `apps/app/src/shell/session/SessionGate.tsx`
- Modify: `apps/app/src/shell/session/stored.ts`
- Test: `apps/app/src/shell/session/session.test.ts`
- Test: `apps/app/tests/shell.real.cmdk.test.tsx`

- [ ] **Step 1: Write failing packaged-origin tests**

Render `SessionGate` at `tauri://localhost` with no stored session and assert `Connect a Space` appears, `tauri` never becomes an invite or host, and a pending `join` link supplies its HTTPS address/code/fingerprint to the join flow.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node scripts/test-run.mjs --files apps/app/src/shell/session/session.test.ts apps/app/tests/shell.real.cmdk.test.tsx`

Expected: FAIL because `spaceAddress()` still returns the Tauri origin.

- [ ] **Step 3: Implement desktop origin detection and routing**

Make `spaceAddress()` accept only HTTP(S). Add a desktop adapter that calls the typed bridge when present, maps `open|signin|join|pair` to the existing v1 flows, and unsubscribes on unmount. With no address, render the approved Connect a Space welcome instead of an error or fabricated Space.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node scripts/test-run.mjs --files apps/app/src/shell/session/session.test.ts apps/app/tests/shell.real.cmdk.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/shell/session/desktop.ts apps/app/src/shell/session/SessionGate.tsx apps/app/src/shell/session/stored.ts apps/app/src/shell/session/session.test.ts apps/app/tests/shell.real.cmdk.test.tsx changelog.md
git commit -m "fix: connect packaged desktop to a real Space"
```

### Task 3: Prove the packaged flow

**Files:**
- Modify: `apps/desktop/tests/shell.heavy.test.ts`
- Modify: `apps/desktop/src-tauri/ci/desktop.yml`
- Modify: `.github/workflows/desktop.yml`

- [ ] **Step 1: Add a failing packaged-flow assertion**

Require the captured first launch to show `Connect a Space`, reject `Sign in to tauri`, inject a safe fixture deep link, and prove the app renders the named fixture Space without logging its code.

- [ ] **Step 2: Run the platform-neutral test and verify RED**

Run: `node scripts/test-run.mjs --files apps/desktop/tests/shell.heavy.test.ts`

Expected: FAIL on the new packaged bootstrap assertion.

- [ ] **Step 3: Update the desktop smoke harness**

Teach the harness to pass a fixture deep link through the same launch/second-instance path used by production and capture post-link screenshots. Keep the existing sidecar, cleanup, signature, and artifact assertions unchanged.

- [ ] **Step 4: Run local tests and dispatch both platform jobs**

Run: `node scripts/test-run.mjs --files apps/desktop/tests/native.test.ts apps/desktop/tests/shell.heavy.test.ts`

Run: `gh workflow run desktop.yml --ref codex/v1-desktop-space-bootstrap`

Expected: macOS and Windows build, cleanly stop, capture Connect/Space screens, and upload artifacts.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/tests/shell.heavy.test.ts apps/desktop/src-tauri/ci/desktop.yml .github/workflows/desktop.yml changelog.md
git commit -m "test: prove packaged desktop Space bootstrap"
```
